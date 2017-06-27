import debugFactory from 'debug';
let debug = debugFactory('node::client');

import {events} from './enum';
import globals from './globals';
import ActorModel from './actor';
import {Dealer as DealerSocket} from './sockets';

let _private = new WeakMap();

export default class Client extends DealerSocket {
    constructor(data = {}) {
        let {options} = data;
        super();
        let _scope = {
            server : null,
            pingInterval : null
        };

        this.setOptions(options);

        debug(`Client ${this.getId()} started`);
        _private.set(this, _scope);
    }

    getServerActor() {
        return _private.get(this).server;
    }

    // ** returns a promise which resolves with server model after server replies to events.CLIENT_CONNECTED
    async connect(serverAddress) {
        let _scope = _private.get(this);
        await super.connect(serverAddress);
        let {actor, options} = await this.request(events.CLIENT_CONNECTED, {actor: this.getId(), options: this.getOptions()});
        // ** creating server model and setting it online

        _scope.server = new ActorModel( {id: actor, options: options, online: true, address: serverAddress});
        this::_startServerPinging();
    }

    async disconnect(options) {
        let _scope = _private.get(this);
        let disconnectData = { actor : this.getId()};
        if(options) {
            disconnectData.options = options;
        }

        await this.request(events.CLIENT_STOP, disconnectData);
        this::_stopServerPinging();
        super.disconnect();
        let serverId = _scope.server ? _scope.server.getId() : null;
        _scope.server = null;
        return serverId;
    }
}

function _startServerPinging(){
    let context = this;
    let _scope = _private.get(context);

    if(_scope.pingInterval) {
        clearInterval(_scope.pingInterval);
    }

    _scope.pingInterval = setInterval(async ()=> {
        let pingRequest = { actor: context.getId(), stamp : Date.now()};
        let pingResponse = await context.request(events.CLIENT_PING, pingRequest);
        if(_scope.server) {
            _scope.server.ping(pingResponse);
        }
    } , globals.CLIENT_PING_INTERVAL);
}

function _stopServerPinging() {
    let _scope = _private.get(this);

    if(_scope.pingInterval) {
        clearInterval(_scope.pingInterval);
    }
}