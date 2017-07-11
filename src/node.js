/**
 * Created by avar and dave on 2/14/17.
 */
import debugFactory from 'debug';
let debug = debugFactory('node::node');

import _ from 'underscore';
import  Promise from 'bluebird';
import md5 from 'md5';
import animal from 'animal-id';
import { EventEmitter } from 'events'
import { RequestWatcher, TickWatcher} from './sockets'

import Server from './server';
import Client from './client';
import globals from './globals';
import { events } from './enum'
import * as crypto from "crypto";

const _private = new WeakMap();


export default class Node extends EventEmitter {
    constructor({id, bind, options = {}}) {
        super();

        id = id || _generateNodeId();

        let _scope = {
            id,
            options,
            nodeServer : new Server({id, bind, options}),
            nodeClients : new Map(),
            nodeClientsAddressIndex : new Map(),
            tickWatcherMap: new Map(),
            requestWatcherMap: new Map()
        };
        _scope.nodeServer.on('error', (err) => {
            this.emit('error', err);
        });
        _private.set(this, _scope);
    }

    getId() {
        let _scope = _private.get(this);
        return _scope.id;
    }

    getAddress() {
        let _scope = _private.get(this);
        if(_scope.nodeServer) {
            return _scope.nodeServer.getAddress();
        }
    }

    getOptions() {
        let _scope = _private.get(this);
        return _scope.options;
    }

    getFilteredNodes(filter = {}){
        let _scope = _private.get(this);
        let nodes = [];

        function checkNode (node) {
            let options = node.getOptions();
            let notSatisfying = !!_.find(filter, (filterValue, filterKey) => {
                if (filterValue instanceof RegExp && typeof options[filterKey] == 'string') {
                    return !filterValue.test(options[filterKey]);
                } else if (!(filterValue instanceof RegExp)) {
                    return !(filterValue == options[filterKey])
                }
                return true;
            });
            if (!notSatisfying) {
                nodes.push(node.id);
            }
        }
        if(_scope.nodeServer) {
            _scope.nodeServer.getOnlineClients().forEach(checkNode, this);
        }

        if(_scope.nodeClients.size) {
            _scope.nodeClients.forEach((client) => {
                let actorModel = client.getServerActor();
                if(actorModel.isOnline()) {
                    checkNode(actorModel);
                }
            }, this);
        }
        return nodes;
    }

    async bind(routerAddress) {
        let _scope = _private.get(this);
        _scope.nodeServer.on(events.CLIENT_FAILURE, this::_clientFailureHandler);
        return await _scope.nodeServer.bind(routerAddress);
    }

    unbind() {
        let _scope = _private.get(this);
        if(!_scope.nodeServer) {
            return true;
        }
        _scope.nodeServer.removeAllListeners(events.CLIENT_FAILURE);
        _scope.nodeServer.unbind();
        _scope.nodeServer = null;
        return true;
    }

    // ** connect returns the id of the connected node
    async connect(address = 'tcp://127.0.0.1:3000') {
        if (typeof address != 'string' || address.length == 0) {
            throw new Error(`Wrong type for argument address ${address}`);
        }

        let _scope = _private.get(this);
        let addressHash = md5(address);

        if (_scope.nodeClientsAddressIndex.has(addressHash)) {
            return _scope.nodeClientsAddressIndex.get(addressHash);
        }

        let client = new Client({id: _scope.id, options: _scope.options});

        client.on(events.SERVER_FAILURE, this::_serverFailureHandler);
        client.on('error', (err) => {
            this.emit('error', err);
        });
        let {actorId, options} = await client.connect(address);

         debug(`Node connected: ${this.getId()} -> ${actorId}`);
        _scope.nodeClientsAddressIndex.set(addressHash, actorId);
        _scope.nodeClients.set(actorId, client);

        this::_addExistingListenersToClient(client);
        return actorId;
    }

    async disconnect(address = 'tcp://127.0.0.1:3000') {
        if (typeof address != 'string' || address.length == 0) {
            throw new Error(`Wrong type for argument address ${address}`);
        }

        let addressHash = md5(address);

        let _scope = _private.get(this);
        if(!_scope.nodeClientsAddressIndex.has(addressHash)) {
            return true;
        }

        let nodeId = _scope.nodeClientsAddressIndex.get(addressHash);
        let client = _scope.nodeClients.get(nodeId);

        client.removeAllListeners(events.SERVER_FAILURE);

        await client.disconnect();
        this::_removeClientAllListeners(client);
        _scope.nodeClients.delete(nodeId);
        _scope.nodeClientsAddressIndex.delete(addressHash);
        return true;
    }

    async stop() {
        let _scope = _private.get(this);
        let stopPromise = [];
        if(_scope.nodeServer.isOnline()) {
            _scope.nodeServer.unbind();
        }

        _scope.nodeClients.forEach((client)=>{
            if(client.isOnline()) {
                stopPromise.push(client.disconnect());
            }
        }, this);

        await Promise.all(stopPromise);
    }

    onRequest(endpoint, fn) {
        let _scope = _private.get(this);

        let requestWatcher = _scope.requestWatcherMap.get(endpoint);
        if(!requestWatcher) {
            requestWatcher = new RequestWatcher(endpoint);
            _scope.requestWatcherMap.set(endpoint, requestWatcher);
        }

        requestWatcher.addRequestListener(fn);

        _scope.nodeServer.onRequest(endpoint, fn);

        _scope.nodeClients.forEach((client)=>{
            client.onRequest(endpoint, fn);
        }, this);
    }

    offRequest(endpoint, fn) {
        let _scope = _private.get(this);
        _scope.nodeServer.offRequest(endpoint);
        _scope.nodeClients.forEach((client)=>{
            client.offRequest(endpoint, fn);
        });

        let requestWatcher = _scope.requestWatcherMap.get(endpoint);
        if(requestWatcher) {
            requestWatcher.removeRequestListener(fn);
        }
    }

    onTick(event, fn) {
        let _scope = _private.get(this);

        let tickWatcher = _scope.tickWatcherMap.get(event);
        if(!tickWatcher) {
            tickWatcher = new TickWatcher(event);
            _scope.tickWatcherMap.set(event, tickWatcher);
        }

        tickWatcher.addTickListener(fn);

        // ** _scope.nodeServer is constructed in Node constructor
        _scope.nodeServer.onTick(event, fn);

        _scope.nodeClients.forEach((client)=>{
            client.onTick(event, fn);
        });
    }

    offTick(event, fn) {
        let _scope = _private.get(this);
        _scope.nodeServer.offTick(event);
        _scope.nodeClients.forEach((client)=>{
            client.offTick(event, fn);
        }, this);

        let tickWatcher = _scope.tickWatcherMap.get(event);
        if(tickWatcher) {
            tickWatcher.removeTickListener(fn);
        }
    }

    async request(nodeId, endpoint, data, timeout = globals.REQUEST_TIMEOUT) {
        let _scope = _private.get(this);

        let clientActor = this::_getClientByNode(nodeId);
        if(clientActor) {
            return _scope.nodeServer.request(clientActor.getId(), endpoint, data, timeout);
        }

        if(_scope.nodeClients.has(nodeId)) {
            // ** nodeId is the serverId of node so we request
            return _scope.nodeClients.get(nodeId).request(endpoint, data, timeout);
        }

        throw new Error(`Node with ${nodeId} is not found.`);
    }

    async tick(nodeId, event, data) {
        let _scope = _private.get(this);

        let clientActor = this::_getClientByNode(nodeId);
        if(clientActor) {
            return _scope.nodeServer.tick(clientActor.getId(), event, data);
        }

        if(_scope.nodeClients.has(nodeId)) {
            return _scope.nodeClients.get(nodeId).tick(event, data);
        }

        throw new Error(`Node with ${nodeId} is not found.`);
    }

    async requestAny(endpoint, data, timeout = globals.REQUEST_TIMEOUT, filter = {}) {
        let filteredNodes = this.getFilteredNodes(filter);
        let nodeId = this::_getWinnerNode(filteredNodes, endpoint);
        return this.request(nodeId, endpoint, data, timeout);
    }

    async tickAny(event, data, filter = {}) {
        let filteredNodes = this.getFilteredNodes(filter);
        if (!filteredNodes.length) {
            throw 'there is no node with that filter';
        }
        let nodeId = this::_getWinnerNode(filteredNodes, event);
        return this.tick(nodeId, event, data);
    }

    async tickAll(event, data, filter = {}) {
        let filteredNodes = this.getFilteredNodes(filter);
        let tickPromises = [];

        filteredNodes.forEach((nodeId)=> {
            tickPromises.push(this.tick(nodeId, event, data));
        }, this);

        return Promise.all(tickPromises);
    }
}

// ** PRIVATE FUNCTIONS

function _getClientByNode(nodeId) {
    let _scope = _private.get(this);
    let actors = _scope.nodeServer.getOnlineClients().filter((actor) => {
        let { node } =  actor.getOptions();
        return node == nodeId;
    });

    if(!actors.length) {
        return null;
    }

    if(actors.length > 1) {
        return debug(`We should have just 1 client from 1 node`);
    }

    return actors[0];
}

function _generateNodeId() {
    return animal.getId()
}

function _getWinnerNode(nodeIds, tag) {
    let len = nodeIds.length;
    let idx = Math.floor(Math.random() * len);
    return nodeIds[idx];
}

function _addExistingListenersToClient(client) {
    let _scope = _private.get(this);

    // ** adding previously added onTick-s for this client to
    _scope.tickWatcherMap.forEach((tickWatcher, event) => {
        // ** TODO what about order of functions ?
        tickWatcher.getFnSet().forEach((fn) => {
            client.onTick(event, this::fn);
        }, this);
    }, this);

    // ** adding previously added onRequests-s for this client to
    _scope.requestWatcherMap.forEach((requestWatcher, endpoint) => {
        // ** TODO what about order of functions ?
        requestWatcher.getFnSet().forEach((fn) => {
            client.onRequest(endpoint, this::fn);
        }, this);
    }, this);
}

function _removeClientAllListeners(client) {
    let _scope = _private.get(this);

    // ** adding previously added onTick-s for this client to
    _scope.tickWatcherMap.forEach((tickWatcher, event) => {
        client.offTick(event, this::fn);
    }, this);

    // ** adding previously added onRequests-s for this client to
    _scope.requestWatcherMap.forEach((requestWatcher, endpoint) => {
        client.offRequest(endpoint);
    }, this);
}

let _clientFailureHandler = (clientActor) => {
    this.emit(events.CLIENT_FAILURE, clientActor.getOptions())
};

let _serverFailureHandler = (serverActor) => {
    this.emit(events.SERVER_FAILURE, serverActor.getOptions());
};