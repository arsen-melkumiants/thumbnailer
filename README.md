## Light and Fast Service for generation thumbnails

```js
var thumbnailer = require('thumbnailer');
var express = require('express');
var app = express();

app.use('/', thumbnailer);

app.listen(3000)
```

## Features

  * Modular sub-app for Express
  * Optimized resizing images according to a format
  * Uses queue request stack for high performance
  * HTTP errors handler
  * Caching images
  * Clearing outdated cache

## Quick Start

Firstly, we need to set a config file. Create a folder **config** and create the file with name **default-0.json**
Read more about [Config](https://www.npmjs.com/package/config) module on npm

An example of config:

```json
{
	"thumbnailer": {
		"secret": "Test",
		"timeout": 1000,
		"cacheControl": 3600,
		"fileCache": {
			"expireAfterDays": 1,
			"cronInterval": "00 00 * * * *"
		},
		"width": {
			"min": 3,
			"max": 1024
		},
		"height": {
			"min": 3,
			"max": 1024
		},
		"downloadExts": {
			"gif": true,
			"jpg": true,
			"jpeg": true,
			"png": true
		},
		"uploadExts": {
			"gif": "im",
			"jpg": true,
			"jpeg": true,
			"png": true,
			"ico": "im",
			"webm": "im"
		}
	}
}
```

## Examples

URL with test image
/aHR0cDovL3d3dy5wcml2YXRlaXNsYW5kbmV3cy5jb20vd3AtY29udGVudC91cGxvYWRzLzIwMTMvMTIvSEREU0NfMDA1MS5qcGc/500/300/hYBRDyFhjuykKPp-NXGdzviXJ2H0gZtzqN9sC9capHs.jpg

Put it into browser address field

## License

  [MIT](LICENSE)
