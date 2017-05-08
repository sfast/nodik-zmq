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
        return this.getClientById(id) ? this.getClientById(id).isOnline() : false;
    }

    getOnlineClients() {
        let _scope = _private.get(this);
        let onlineClients = [];
        _scope.clientModels.forEach((actor) => {
           if( actor.isOnline()) {
               onlineClients.push(actor);
           }
        });

        return onlineClients;
    }

    async bind(bindAddress) {
        // ** ATTACHING client connected
        this.onRequest(events.CLIENT_CONNECTED, this::_clientConnectedRequest);

        // ** ATTACHING client stop
        this.onRequest(events.CLIENT_STOP, this::_clientStopRequest);

        // ** ATTACHING client ping
        this.onRequest(events.CLIENT_PING, this::_clientPingRequest);

        return super.bind(bindAddress);
    }

    async unbind(){
        this.offRequest(events.CLIENT_CONNECTED);
        this.offRequest(events.CLIENT_STOP);
        this.offRequest(events.CLIENT_PING);
        return super.unbind();
    }
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
    let context = this;
    let _scope = _private.get(context);
    let {actor, data} = request.body;

    let actorModel = _scope.clientModels.get(actor);
    actorModel.markStopped();
    actorModel.setData(data);

    context.emit(events.CLIENT_STOP, actorModel);
    request.reply("BYE");
}

function _clientConnectedRequest(request) {
    let context = this;
    let _scope = _private.get(context);

    let {actor, data, response} = request.body;
    response = !_.isArray(response) ? [] : response;

    let actorModel = new ActorModel({id: actor, data: data});
    actorModel.setOnline();

    if(!_scope.clientCheckInterval) {
        _scope.clientCheckInterval = setInterval(context::_checkClientHeartBeat, INTERVAL_CHECK_CLIENT_HEARTBEAT);
    }

    let responseObj = {};
    response.forEach((itemKey) => {
        responseObj[itemKey] = context.getItem(itemKey);
    });

    let replyData = {actor: context.getId()};
    if(response.length) {
        replyData.response = responseObj;
    }
    // ** replyData {actor, response}
    request.reply(replyData);

    _scope.clientModels.set(actor, actorModel);
    context.emit(events.CLIENT_CONNECTED, actorModel);
}

// ** check clients heartbeat
function _checkClientHeartBeat(){
    let context = this;
    this.getOnlineClients().forEach((actor) => {
        if (!actor.isGhost()) {
            actor.markGhost();
        } else {
            actor.markFailed();
            debug(`Server ${context.getId()} identifies client failure`, actor);
            context.emit(events.CLIENT_FAILURE, actor);
        }
    });
}