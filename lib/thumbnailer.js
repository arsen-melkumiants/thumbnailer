var base64url = require('base64-url');
var fileType = require('file-type');
var request = require('request');
var config = require('config').get('thumbnailer');
var CronJob = require('cron').CronJob;
var mkdirp = require('mkdirp');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var gm = require('gm');
var im = require('gm').subClass({imageMagick: true});

var journal = {};
var mediaFolder;
var allowedExts = config.uploadExts;
var secret = config.secret;

/**
 * Set upload folder for thumbnails
 * @param {string} - absolute path to folder
 * @return {string} - result path
 */
var _setMediaFolder = function (customMediaFolder) {
	mediaFolder = customMediaFolder;
};

/**
 * Generate and return decret signature
 * @param  {base64} - encoded URL of a source image
 * @param  {number} - max thumbnail width
 * @param  {number} - max thumbnail width
 * @param  {string} - file extension for thumbnail
 * @return {base64} - signature for checking request
 */
var _getSignature = function (urlBase64, width, height, ext) {
	var hmac = crypto.createHmac('sha256', secret)
		.update(urlBase64)
		.update(width.toString())
		.update(height.toString())
		.update(ext)
		.digest('base64');
	return base64url.escape(hmac);
};

/**
 * Check signature
 * @param  {object} - URL params (base64 URL, width, height, extension, signature)
 * @return {bool} - result of checking signature
 */
var _isValidSignature = function (params) {
	var signature = _getSignature(params.urlBase64, params.width, params.height, params.ext);
	return signature === params.signature;
};

/**
 * Check URL params
 * @param  {object} - URL params (width, height, extension)
 * @return {boolean} - result of checking URL params
 */
var _isValidParams = function (params) {
	if (params.width < config.width.min || params.width > config.width.max) {
		console.error('Wrong width:', params.width + 'px');
		return false;
	}

	if (params.height < config.height.min || params.height > config.height.max) {
		console.error('Wrong height:', params.height + 'px');
		return false;
	}

	if (!config.downloadExts[params.ext]) {
		console.error('Wrong extension:', params.ext);
		return false;
	}

	return true;
};

/**
 * Stream downloading source image as a temp file
 * @param  {string} - URL of a source image
 * @param  {string} - absolute path of a downloaded file
 * @return {promise} - absolute path of a downloaded file
 */
var _download = function (imageURL, filePath) {
	var type;
	var stream;

	return new Promise ((resolve, reject) => {
		mkdirp(path.dirname(filePath), e => {
			if (e) {
				return reject(e);
			}

			request.get(imageURL, { timeout: config.timeout })
				.on('response', function(res) {
					res
					//Checks an image type by receiving a first chunk of the request
					//Prevents loading fake huge files
					.once('data', chunk => {
						type = fileType(chunk);

						if (!type || !allowedExts[type.ext]) {
							res.destroy();
							console.error('Wrong content of the link: ' + imageURL);
							return reject('wrong_image');
						}

						filePath = filePath + '.' + type.ext;
						stream = fs.createWriteStream(filePath);
						stream.write(chunk);

						res.on('data', chunk => {
							stream.write(chunk);
						});
						res.on('end', () => {
							stream.on('finish', () => {
								resolve(filePath);
							});
							stream.on('error', e => {
								stream.end();
								fs.unlink(filePath);
								reject(e);
							});
							stream.end();
						});
					})
					.on('error', () => {
						res.destroy();
					});
				})
				.on('error', e => {
					reject(e);
				});
		});
	});
};



/**
 * Convert file to thumbnail according to URL params
 * @param  {string} - temp file of a source image
 * @param  {string} - thumbnail file path
 * @param  {number} - max thumbnail width
 * @param  {number} - max thumbnail width
 * @param  {string} - file extension for thumbnail
 * @return {promise} - thumbnail file path
 */
var _convert = function(tempFilePath, filePath, width, height, ext) {
	var width = width;
	var height = height;
	var originExt = path.extname(tempFilePath).replace('.', '');
	var processor = allowedExts[originExt] !== 'im' ? im : gm;

	return new Promise((resolve, reject) => {
		processor(tempFilePath)
			.size({ bufferStream: true }, function (e, size) {
				if (e) {
					fs.unlink(tempFilePath);
					return reject(e);
				}

				width = size.width > width ? width : size.width;
				height = size.height > height ? height : size.height;

				this.resize(width, height);
				this.flatten();
				this.setFormat(ext);
				this.write(filePath, e => {
					fs.unlink(tempFilePath);
					if (e) {
						return reject(e);
					}

					return resolve(filePath);
				});
			});
	});
};

/**
 * Resolves promises of all requests in queue for a particular file
 * @param  {string} - thumbnail file path
 */
var _resolveQueue = function (filePath) {
	journal[filePath].forEach(callback => callback.resolve(filePath));
	journal[filePath] = null;
};

/**
 * Rejects promises of all requests in queue for a particular file
 * @param  {string} - thumbnail file path
 */
var _rejectQueue = function (filePath, e) {
	journal[filePath].forEach(callback => callback.reject(e));
	journal[filePath] = null;
};

/**
 * Check a queue of the converting file. If it's already in progress, return promise
 * Prevents of processing the same thumbnail file
 * @param  {string} - thumbnail file path
 * @return {promise} - thumbnail file path
 */
var _checkQueue = function (filePath) {
	return new Promise (resolve => {
		if (journal[filePath]) {
			var queuePromise = new Promise((resolve, reject) => {
				journal[filePath].push({'resolve': resolve, 'reject': reject});
			});
			return resolve(queuePromise);
		}

		fs.stat(filePath, (e, stats) => {
			if (e || !stats.isFile()) {
				journal[filePath] = [];
				return resolve(false);
			}

			return resolve(filePath);
		});
	});
};

/**
 * Main function of generating thumbnails
 * @param  {object} - URL params (base64 URL, width, height, extension, signature)
 * @return {promise} - thumbnail file path
 */
var _generate = function (params) {
	if (!mediaFolder) {
		return Promise.reject('Warning: Media folder hasn\'t been set, please, use setMediaFolder()');
	}
	var imageURL = base64url.decode(params.urlBase64);
	var fileName = crypto.createHash('md5')
		.update(imageURL)
		.update(params.width.toString())
		.update(params.height.toString())
		.digest('hex');
	var filePath = mediaFolder + '/' + fileName + '.' + params.ext;
	var tempFilePath = mediaFolder + '/temp/' + fileName;

	//Prevent loading of a huge fake file
	return _checkQueue(filePath)
		.then((result) => {
			if (result) {
				return result;
			}

			return _download(imageURL, tempFilePath)
				.then((tempFileWithExt) => {
					tempFilePath = tempFileWithExt;
				})
				.then(() => _convert(tempFilePath, filePath, params.width, params.height, params.ext))
				.then((filePath) => {
					_resolveQueue(filePath);
					return filePath;
				})
				.catch((e) => {
					_rejectQueue(filePath, e);
					return Promise.reject(e);
				});
		});
};

/**
 * Delete outdated (config.fileCache.expireAfterDays) media files
 * @return {promise} - array of deleted files
 */
var _clean = function () {
	var checkDate = new Date();
	var promises = [];
	var expireAfterDays = config.fileCache && config.fileCache.expireAfterDays || 1;

	checkDate.setDate(checkDate.getDate() - expireAfterDays);

	return new Promise((resolve, reject) => {
			fs.readdir(mediaFolder, (e, files) => {
				if (e) {
					return reject(e);
				}

				resolve(files);
			});
		})
		.then(files => {
			files.forEach(item => {
				var mediaFile = mediaFolder + '/' + item;

				promises.push(new Promise ((resolve, reject) => {
					fs.stat(mediaFile, (e, stats) => {
						if (e) {
							return reject(e);
						}

						if (stats.isFile() && checkDate > stats.mtime) {
							fs.unlink(mediaFile);
							return resolve(mediaFile);
						}

						resolve(false);
					});
				}));
			});

			return Promise.all(promises);
		})
		.then(files => files.filter(item => item));
};

/**
 * Cron job which deletes outdated media files
 * @return {[type]} [description]
 */
var _cleanCronJob = function (cronInterval) {
	var cronInterval = config.fileCache && config.fileCache.cronInterval || cronInterval;

	if (!cronInterval) {
		console.warn('Set config.fileCache.cronInterval for cron job to clear outdated media files');
		return false;
	}

	return new CronJob(cronInterval, () => {
		this.clean()
			.then(files => console.log('Clean job:', files.length, 'files has been deleted'))
			.catch(e => console.error(e.stack || e));
	}, null, true, 'America/Los_Angeles');
};

module.exports = {
	getSignature: _getSignature,
	isValidParams: _isValidParams,
	isValidSignature: _isValidSignature,
	setMediaFolder: _setMediaFolder,
	generate: _generate,
	clean: _clean,
	cleanCronJob: _cleanCronJob
};