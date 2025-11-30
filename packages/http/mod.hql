(fn request [url options] (js/fetch url options))
(fn get [url] (js/fetch url))
(fn post [url body] (js/fetch url {"method": "POST", "body": body}))
(export [request, get, post])
