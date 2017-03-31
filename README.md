# nodik-zmq

## How to install

> npm install node-zmq

With nodik-zmq its easy to create server(s) <---> server(s) communication (e.g microservices).

You can create various layers(groups) of nodik-s, connect nodiks together and sit back.
You have an awsome comunication layer with nodik-zmq.

> let dns = new Node({id, bind, layer});

(Under the hood we are using http://zeromq.org/ -s Dealer and Router sockets.)


## TODO
- add request timeout and other options to sockets and clisnt
- node layer comunication interface could be improved
- add build with webpack 
- review the scripts
- add examples
