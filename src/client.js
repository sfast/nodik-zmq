import debugFactory from 'debug';
let debug = debugFactory('node::client');

import {events} from './enum'
import ActorModel from './actor'
import {Dealer as DealerSocket} from './sockets'

let _private = new WeakMap();

let INTERVAL_CLIENT_PING = 2000;

export default class Client extends DealerSocket {
    constructor() {
        super();
        let _scope = {
            server : null,
            pingInterval : null
        };

        debug(`Client ${this.getId()} started`);
        _private.set(this, _scope);
    }

    getServerActor() {
        let _scope = _private.get(this);
        return _scope.server;
    }

    // ** returns a promise which resolves with server model after server replies to events.CLIENT_CONNECTED
    connect(serverAddress, {data, response}) {
        let connectData = { actor : this.getId()};
        if(data) {
            connectData.data = data;
        }

        if(response) {
            connectData.response = response;
        }

        let _scope = _private.get(this);
        return super.connect(serverAddress)
            .then((status)=>{
                return this.request(events.CLIENT_CONNECTED, connectData);
            }).then((responseData) => {
                let {actor, response} = responseData;
                // ** creating server model and setting it online
                let actorModel = new ActorModel( {id: actor} );
                actorModel.setAddress(serverAddress);
                actorModel.setOnline();
                actorModel.setData(response);
                _scope.server = actorModel;
                _startServerPinging.bind(this)();
                return actorModel;
            }).catch((err) => {
                debug(err);
            });
    }

    disconnect(data) {
        let disconnectData = { actor : this.getId()};
        if(data) {
            disconnectData.data = data;
        }
        let _scope = _private.get(this);
        return this.request(events.CLIENT_STOP, disconnectData)
            .then((response) => {
                _stopServerPinging.bind(this)();
                return super.disconnect();
            }).then(()=>{
                let serverId = _scope.server ? _scope.server.getId() : null;
                _scope.server = null;
                return serverId;
            });
    }
}

function _startServerPinging(){
    let _scope = _private.get(this);

    if(_scope.pingInterval) {
        clearInterval(_scope.pingInterval);
    }

    _scope.pingInterval = setInterval(()=>{
        let pingData = { actor: this.getId(), stamp : Date.now()};
        this.request(events.CLIENT_PING, pingData)
            .then((data) => {
                if(_scope.server) {
                    _scope.server.ping(data);
                }
            });
    } , INTERVAL_CLIENT_PING);
}

function _stopServerPinging() {
    let _scope = _private.get(this);

    if(_scope.pingInterval) {
        clearInterval(_scope.pingInterval);
    }
}