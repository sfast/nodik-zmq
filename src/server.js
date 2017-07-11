import debugFactory from 'debug';
let debug = debugFactory('node::server');

import _ from 'underscore';
import { events } from './enum';
import globals from './globals';
import ActorModel from './actor';
import * as Errors from './errors'

import { Router as RouterSocket } from './sockets';

let _private = new WeakMap();

export default class Server extends RouterSocket {
    constructor({id, bind, options}) {
        super({id});
        this.setOptions(options);
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
        }, this);

        return onlineClients;
    }

    async bind(bindAddress) {
        try {
            if(_.isString(bindAddress)) {
                this.setAddress(bindAddress);
            }
            // ** ATTACHING client connected
            this.onRequest(events.CLIENT_CONNECTED, this::_clientConnectedRequest);

            // ** ATTACHING client stop
            this.onRequest(events.CLIENT_STOP, this::_clientStopRequest);

            // ** ATTACHING client ping
            this.onRequest(events.CLIENT_PING, this::_clientPingRequest);

            return super.bind(this.getAddress());
        } catch (err) {
            this.emit('error', new Errors.BindError({id: this.getId(), err}))
        }
    }

    unbind(){
        try {
            this.offRequest(events.CLIENT_CONNECTED);
            this.offRequest(events.CLIENT_STOP);
            this.offRequest(events.CLIENT_PING);
            super.unbind();
        } catch(err) {
            this.emit('error', new Errors.BindError({id: this.getId(), err, state: 'unbinding'}))
        }
    }

    onServerFail (fn) {
        let _scope = _private.get(this);
        _scope.ServerFailHandler = fn;
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

//TODO:: @dave, @avar why merge options when disconnecting
function _clientStopRequest(request){
    let context = this;
    let _scope = _private.get(context);
    let {actorId, options} = request.body;

    let actorModel = _scope.clientModels.get(actorId);
    actorModel.markStopped();
    actorModel.mergeOptions(options);

    context.emit(events.CLIENT_STOP, actorModel);
    request.reply(actorModel.getId());
}

function _clientConnectedRequest(request) {
    let _scope = _private.get(this);

    let {actorId, options} = request.body;

    let actorModel = new ActorModel({id: actorId, options: options, online: true});

    if(!_scope.clientCheckInterval) {
        _scope.clientCheckInterval = setInterval(this::_checkClientHeartBeat, globals.CLIENT_MUST_HEARTBEAT_INTERVAL);
    }

    let replyData = Object.assign({actorId: this.getId(), options: this.getOptions()});
    // ** replyData {actorId, options}
    request.reply(replyData);

    _scope.clientModels.set(actorId, actorModel);
    this.emit(events.CLIENT_CONNECTED, actorModel);
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
    }, this);
}