var thumbnailer = require('./lib/thumbnailer');
var config = require('config').get('thumbnailer');
var path = require('path');
var express = require('express');
var router = express.Router();

thumbnailer.setMediaFolder(path.resolve(__dirname, '../media/'));
//thumbnailer.cleanCronJob();

router.get('/:urlBase64/:width/:height/:signature.:ext', function(req, res, next) {
	var params = {
		urlBase64: req.params.urlBase64,
		width: req.params.width,
		height: req.params.height,
		ext: req.params.ext,
		signature: req.params.signature
	};

	if (!thumbnailer.isValidParams(params)) {
		return res.status(400).end('Bad Request');
	}

	if (!thumbnailer.isValidSignature(params)) {
		return res.status(403).end('Forbidden');
	}

	thumbnailer.generate(params)
		.then(filePath => {
 			res.setHeader('Cache-Control', 'public, max-age=' + config.cacheControl);
			res.sendFile(filePath);
		})
		.catch(e => {
			if (e === 'timeout') {
				return res.status(504).end('Gateway timeout');
			} else if (e === 'wrong_image') {
				return res.status(400).end('Bad Request');
			} else {
				console.error(e.stack || e);
				return res.status(500).end('Internal Server Error');
			}
		});
});

//http://fs213.www.ex.ua/get/73548855/000_cover.png
router.get('/generate_signature/:urlBase64/:width/:height/:ext', function(req, res, next) {
	var urlBase64 = req.params.urlBase64;
	var width = req.params.width;
	var height = req.params.height;
	var ext = req.params.ext;

	res.end(thumbnailer.getSignature(urlBase64, width, height, ext));
});

module.exports = router;