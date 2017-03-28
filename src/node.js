/**
 * Created by avar and dave on 2/14/17.
 */
import debugFactory from 'debug';
let debug = debugFactory('node::node');

import _ from 'underscore'
import  Promise from 'bluebird'
import md5 from 'md5'
import animal from 'animal-id'

import { events } from './enum'
import Server from './server'
import Client from './client'

const _private = new WeakMap();

class WatcherData {
    constructor() {
        this._nodeSet = new Set();
        this._fnSet = new Set();
    }

    getFnSet() {
        // console.log(`getFnSet ${this._event}`);
        return this._fnSet;
    }

    addFn(fn) {
        // console.log(`addFn ${this._event}`);
        if(_.isFunction(fn)) {
            this._fnSet.add(fn);
        }
    }

    removeFn(fn){
        // console.log(`removeFn ${this._event}`);
        if(_.isFunction(fn)) {
            this._fnSet.delete(fn);
            return;
        }

        this._fnSet = new Set();
    }

    addProxyNode(nodeId) {
        // console.log(`addProxyNode ${this._event}`);
        this._nodeSet.add(nodeId);
    }

    hasProxyNode(nodeId) {
        // console.log(`hasProxyNode ${this._event}`);
        return this._nodeSet.has(nodeId);
    }

    getProxyNodeSize() {
        // console.log(`getProxyNodeSize ${this._event}`);
        return this._nodeSet.size;
    }
}

class TickWatcher extends  WatcherData {
    constructor(event) {
        super();
        this._event = event;
    }

    addTickListener(fn) {
        this.addFn(fn);
    }

    removeTickListener(fn){
        this.removeFn(fn);
    }
}

class RequestWatcher extends  WatcherData{
    constructor(endpoint) {
        super();
        this._endpoint = endpoint;
    }

    addRequestListener(fn) {
        this.addFn(fn);
    }

    removeRequestListener(fn){
        this.removeFn(fn);
    }
}

export default class Node  {
    constructor({id, bind, layer}) {
        let _scope = {
            id : id || _generateNodeId(),
            layer : layer || 'default',
            nodeServer : new Server(bind),
            nodeClients : new Map(),
            nodeClientsAddressIndex : new Map(),

            tickWatcherMap: new Map(),
            requestWatcherMap: new Map()
        };

        // ** this data we will use during client connections as to be able to reply client connections with node id
        _scope.nodeServer.setItem("node", _scope.id);
        _scope.nodeServer.setItem("layer", _scope.layer);

        _private.set(this, _scope);
    }

    getId() {
        let _scope = _private.get(this);
        return _scope.id;
    }

    getLayer() {
        let _scope = _private.get(this);
        return _scope.layer;
    }

    getAddress() {
        let _scope = _private.get(this);
        if(_scope.nodeServer) {
            return _scope.nodeServer.getAddress();
        }
    }

    getNodes(layerFilter){
        let _scope = _private.get(this);
        let nodes = [];
        if(_scope.nodeServer) {
            _scope.nodeServer.getOnlineClients().forEach((client) => {
                let {node, layer} = client.getData();
                if(layer == layerFilter) {
                    nodes.push(node);
                }
            });
        }

        if(_scope.nodeClients.size) {
            _scope.nodeClients.forEach((client, nodeId) => {
                let actorModel = client.getServerActor();
                if(actorModel.isOnline()) {
                    let {node, layer} = actorModel.getData();
                    if(layer == layerFilter) {
                        nodes.push(node);
                    }
                }
            });
        }

        return nodes;
    }

    bind(routerAddress) {
        let _scope = _private.get(this);
        if(!_scope.nodeServer) {
            _scope.nodeServer = new Server();
        }
        _scope.nodeServer.bind(routerAddress);

        // ** TODO specify what we need under _onNodeConnected ?
        // _scope.nodeServer.on(events.CLIENT_CONNECTED, _onNodeConnected.bind(this));
    }

    unbind() {
        let _scope = _private.get(this);
        if(_scope.nodeServer) {
            return  _scope.nodeServer.unbind()
                .then((serverId)=>{
                    _scope.nodeServer = null;
                    return true;
                });
        }

        return Promise.resolve(() => {
            return false;
        });
    }

    connect(address = 'tcp://127.0.0.1:3000') {
        return new Promise((resolve, reject) => {
            if (typeof address != 'string' || address.length == 0) {
                return reject('Wrong type for argument address');
            }

            let _scope = _private.get(this);
            let addressHash = md5(address);



            let nodeClientPromise = null;

            if (!_scope.nodeClientsAddressIndex.has(addressHash)) {
                let client = new Client();
                let connectMsg = {node: this.getId(), layer : this.getLayer()};
                nodeClientPromise = client.connect(address, { data: connectMsg, response: ['node', 'layer']})
                    .then(() => {
                        let actorModel = client.getServerActor();

                        let {node, layer} = actorModel.getData();
                        debug(`Node connected: ${this.getId()} -> ${node}`);
                        _scope.nodeClientsAddressIndex.set(addressHash, node);
                        _scope.nodeClients.set(node, client);

                        _addExistingListenersToClient.bind(this)(client);

                        return node;
                    });
            } else {
                nodeClientPromise = Promise.resolve(() => {
                    let nodeId = _scope.nodeClientsAddressIndex.get(addressHash);
                    return nodeId;
                });
            }

            return nodeClientPromise.then((client)=> {
                resolve();
            })
        });
    }

    disconnect(address = 'tcp://127.0.0.1:3000') {
        let addressHash = md5(address);

        return new Promise((resolve, reject) => {
            if (typeof address != 'string' || address.length == 0) {
                return reject('Wrong type for argument address');
            }

            let _scope = _private.get(this);

            if(!_scope.nodeClientsAddressIndex.has(addressHash)) {
                return resolve();
            }

            let nodeId = _scope.nodeClientsAddressIndex.get(addressHash);
            let client = _scope.nodeClients.get(nodeId);
            return client.disconnect().then(() => {
                _removeClientAllListeners.bind(this)(client)
                _scope.nodeClients.delete(nodeId);
                _scope.nodeClientsAddressIndex.delete(addressHash)
                resolve();
            });
        });
    }

    stop() {
        let _scope = _private.get(this);
        let stopPromise = [];
        if(_scope.nodeServer.isOnline()) {
            stopPromise.push(_scope.nodeServer.unbind());
        }

        _scope.nodeClients.forEach((client)=>{
            if(client.isOnline()) {
                stopPromise.push(client.disconnect());
            }
        });

        return Promise.all(stopPromise);
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
        });
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
        });

        let tickWatcher = _scope.tickWatcherMap.get(event);
        if(tickWatcher) {
            tickWatcher.removeTickListener(fn);
        }
    }

    request(nodeId, endpoint, data, timeout = 5000) {
        let _scope = _private.get(this);

        let clientActor = _getClientByNode.bind(this)(nodeId);

        if(clientActor) {
            return _scope.nodeServer.request(clientActor.getId(), endpoint, data, timeout);
        }

        if(_scope.nodeClients.has(nodeId)) {
            // ** nodeId is the serverId of node so we request
            return _scope.nodeClients.get(nodeId).request(endpoint, data, timeout )
        }
    }

    tick(nodeId, event, data) {
        let _scope = _private.get(this);

        let clientActor = _getClientByNode.bind(this)(nodeId);
        if(clientActor) {
            return _scope.nodeServer.tick(clientActor.getId(), event, data);
        }

        if(_scope.nodeClients.has(nodeId)) {
            // ** nodeId is the serverId of node so we request
            return _scope.nodeClients.get(nodeId).tick(event, data);
        }

        return Promise.reject(`Node with ${nodeId} is not found.`);
    }

    requestLayerAny(layer, endpoint, data, timeout = 5000) {
        let layerNodes = this.getNodes(layer);
        let nodeId = _getWinnerNode.bind(this)(layerNodes, endpoint);
        return this.request(nodeId, endpoint, data, timeout);
    }

    tickLayerAny(layer, event, data) {
        let layerNodes = this.getNodes(layer);
        let nodeId = _getWinnerNode.bind(this)(layerNodes, event);
        return this.tick(nodeId, event, data);
    }

    tickLayer(layer, event, data) {
        let layerNodes = this.getNodes(layer);
        let tickPromises = [];

        layerNodes.forEach((nodeId)=> {
            tickPromises.push(this.tick(nodeId, event, data));
        });

        return Promise.all(tickPromises);
    }

    // ** TODO what if we add a fn to process data
    // ** we can proxy event to multiple endpoints
    proxyTick(eventsToProxy, nodeId, fn) {
        if(_.isString(eventsToProxy)) {
            eventsToProxy = [eventsToProxy];
        }

        let _scope = _private.get(this);
        eventsToProxy.forEach( (event) => {
            _proxyTickToNode.bind(this)(event, nodeId);
        }, this);
    }

    // ** TODO what if we add a fn to process data
    // ** we can proxy endpoint to just one endpoint
    proxyRequest(fromEndpoint, toNodeId, toEndpoint, timeout = 5000) {
        let _scope = _private.get(this);
        console.log( "proxyRequest",  _scope.requestWatcherMap);
        let _self = this;
        toEndpoint = toEndpoint ? toEndpoint : fromEndpoint;

        let requestWatcher = _scope.requestWatcherMap.get(fromEndpoint);

        if(!requestWatcher) {
            requestWatcher = new RequestWatcher(fromEndpoint);
            _scope.requestWatcherMap.set(fromEndpoint, requestWatcher);
        }

        if(requestWatcher.getProxyNodesSize() > 0) {
            return Promise.reject(`Already has a proxy for ${fromEndpoint}`);
        }

        requestWatcher.addProxyNode(toNodeId);

        _self.onRequest(fromEndpoint, function(request){
            let data = request.body;
            _self.request(toNodeId, toEndpoint, data, timeout)
                .then((responseData) => {
                    request.reply(responseData);
                });
        });

        return Promise.resolve(fromEndpoint);
    }
}

// ** PRIVATE FUNCTIONS

function _getClientByNode(nodeId) {
    let _scope = _private.get(this);
    let actors = _scope.nodeServer.getOnlineClients().filter((actor) => {
        let { node } =  actor.getData();
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
    return animal.getId();
}

function _getWinnerNode(nodeIds, tag) {
    let len = nodeIds.length;
    let idx = Math.floor(Math.random() * len);
    return nodeIds[idx];
}

function _proxyTickToNode(event, nodeId) {
    let _scope = _private.get(this);

    let tickWatcher = _scope.tickWatcherMap.get(event);

    if(!tickWatcher) {
        tickWatcher = new TickWatcher(event);
        _scope.tickWatcherMap.set(event, tickWatcher);
    }

    // ** to be sure that we are adding onTick for each node just once
    if(!tickWatcher.hasProxyNode(nodeId)) {
        tickWatcher.addProxyNode(nodeId);
        this.onTick(event, (data) => {
            this.tick(nodeId, event, data);
        });
    }
}

function _addExistingListenersToClient(client) {
    let _scope = _private.get(this);

    // ** adding previously added onTick-s for this client to
    _scope.tickWatcherMap.forEach((tickWatcher, event) => {
        // ** TODO what about order of functions ?
        tickWatcher.getFnSet().forEach((fn) => {
            client.onTick(event, fn.bind(this));
        }, this);
    }, this);

    // ** adding previously added onRequests-s for this client to
    _scope.requestWatcherMap.forEach((requestWatcher, endpoint) => {
        // ** TODO what about order of functions ?
        requestWatcher.getFnSet().forEach((fn) => {
            client.onRequest(endpoint, fn.bind(this));
        }, this);
    }, this);
}

function _removeClientAllListeners(client) {
    let _scope = _private.get(this);

    // ** adding previously added onTick-s for this client to
    _scope.tickWatcherMap.forEach((tickWatcher, event) => {
        client.offTick(event, fn.bind(this));
    }, this);

    // ** adding previously added onRequests-s for this client to
    _scope.requestWatcherMap.forEach((requestWatcher, endpoint) => {
        client.offRequest(endpoint);
    }, this);
}