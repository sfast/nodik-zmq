import debugFactory from 'debug';
let debug = debugFactory('node::server');

import _ from 'underscore'
import { events } from './enum'
import ActorModel from './actor'

import { Router as RouterSocket } from './sockets'

let _private = new WeakMap();

let INTERVAL_CHECK_CLIENT_HEARTBEAT = 4000;

export default class Server extends RouterSocket {
    constructor(bind) {
        super();
        this.setAddress(bind);

        let _scope = {
            clientModels : new Map(),
            clientCheckInterval : null
        };

        _private.set(this, _scope);
        debug(`Server ${this.getId()} started`);
    }

    getClientById(clientId) {
        let _scope = _private.get(this);
        return _scope.clientModels.has(clientId) ?_scope.clientModels.get(clientId) : null;
    }

    isClientOnline(id){
        if(!this.getClientById(id)) {
            return false;
        }

        return this.getClientById(id).isOnline();
    }

    getOnlineClients() {
        let _scope = _private.get(this);
        let onlineNodes = [];
         _scope.clientModels.forEach((actor) => {
            if(actor.isOnline()) {
                onlineNodes.push(actor);
            }
        });

         return onlineNodes;
    }

    // ** resolves with server id
    bind(bindAddress) {
        return super.bind(bindAddress).then(()=>{
            _attachServerHandlers.bind(this)();
            return this.getId();
        });
    }

    // ** resolves with server id
    unbind(){
        let _scope = _private.get(this);
        // ** DETACHING listeners
        _detachHandlers.bind(this)();
        return super.unbind().then(()=>{
            return this.getId();
        });
    }
}

function _attachServerHandlers() {
    let _scope = _private.get(this);

    // ** ATTACHING client connected
    this.onRequest(events.CLIENT_CONNECTED, _clientConnectedRequest.bind(this));

    // ** ATTACHING client stop
    this.onRequest(events.CLIENT_STOP, _clientStopRequest.bind(this));

    // ** ATTACHING client ping
    this.onRequest(events.CLIENT_PING, _clientPingRequest.bind(this));
}

function _detachHandlers() {
    this.offRequest(events.CLIENT_CONNECTED);
    this.offRequest(events.CLIENT_STOP);
    this.offRequest(events.CLIENT_PING);
}

// ** Request handlers
function _clientPingRequest(request) {
    let _scope = _private.get(this);
    // ** PING DATA FROM CLIENT, actor is client id
    let {actor, stamp, data} = request.body;

    let actorModel = _scope.clientModels.get(actor);

    if(actorModel) {
        actorModel.ping(stamp, data);
    }
    request.reply(Date.now());
}

function _clientStopRequest(request){
    let _scope = _private.get(this);
    let {actor, data} = request.body;

    let actorModel = _scope.clientModels.get(actor);
    actorModel.markStopped();
    actorModel.setData(data);

    this.emit(events.CLIENT_STOP, actorModel);
    request.reply("BYE");
}

function _clientConnectedRequest(request) {
    let _scope = _private.get(this);

    let {actor, data, response} = request.body;
    response = !_.isArray(response) ? [] : response;

    let actorModel = new ActorModel({id: actor, data: data});
    actorModel.setOnline();

    if(!_scope.clientCheckInterval) {
        _scope.clientCheckInterval = setInterval(_checkClientHeartBeat.bind(this), INTERVAL_CHECK_CLIENT_HEARTBEAT);
    }

    let responseObj = {};
    response.forEach((itemKey) => {
        responseObj[itemKey] = this.getItem(itemKey);
    });

    let replyData = {actor: this.getId()};
    if(response.length) {
        replyData.response = responseObj;
    }
    // ** replyData {actor, response}
    request.reply(replyData);

    _scope.clientModels.set(actor, actorModel);
    this.emit(events.CLIENT_CONNECTED, actorModel);
}

// ** check clients heartbeat
function _checkClientHeartBeat(){
    this.getOnlineClients().forEach((actor) => {
        if (!actor.isGhost()) {
            actor.markGhost();
        } else {
            actor.markFailed();
            debug(`Server ${this.getId()} identifies client failure`, actor);
            this.emit(events.CLIENT_FAILURE, actor);
        }
    });
}