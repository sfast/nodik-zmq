import debugFactory from 'debug';
let debug = debugFactory('node::sockets::envelop');

import crypto from 'crypto'

class Parse {
    // serialize
    static dataToBuffer (data) {
        try {
            return new Buffer(JSON.stringify({ data }));
        }
        catch(err) {
            console.error(err);
        }
    }

    // deserialize
    static bufferToData (data) {
        try {
            let ob =  JSON.parse(data.toString());
            return ob.data;
        } catch(err) {
            console.error(err);
        }
    }
}


export default class Envelop {
    constructor({type, id, tag, data, owner}) {
        if(type) {
            this.setType(type);
        }

        this.id = id || crypto.randomBytes(20).toString("hex");
        this.tag = tag;

        if(data) {
            this.data = data;
        }

        this.owner = owner;
    }

    static readMetaFromBuffer(buffer) {
        let type = buffer.readInt8(0);
        let id = buffer.slice(1,21).toString("hex");
        let owner = buffer.slice(21,41).toString("hex");
        let tag = buffer.slice(41,61).toString('utf8').replace(/\0/g, '');

        return {type, id, owner, tag};
    }

    static readDataFromBuffer(buffer) {
        if(buffer.length > 61){
            return Parse.bufferToData(buffer.slice(61));
        }
    }

    static getDataBuffer(buffer) {
        if(buffer.length > 61){
            return buffer.slice(61);
        }
    }

    static fromBuffer(buffer) {
        let {id, type, owner, tag} = Envelop.readMetaFromBuffer(buffer);
        let envelop =  new Envelop({type, id, tag, owner});

        if(buffer.length > 61){
            let envelopData = Parse.bufferToData(buffer.slice(61));
            envelop.setData(envelopData);
        }

        return envelop;
    }

    getBuffer() {
        let bufferArray = [];

        let typeBuffer = Buffer.alloc(1);
        typeBuffer.writeInt8(this.type);
        bufferArray.push(typeBuffer);

        let idBuffer = Buffer.alloc(20);
        idBuffer.write(this.id, 0, 20, 'hex');
        bufferArray.push(idBuffer);

        let ownerBuffer = Buffer.alloc(20);
        ownerBuffer.write(this.owner, 0, 20, 'hex');
        bufferArray.push(ownerBuffer);

        let tagBuffer = Buffer.alloc(20, '');
        tagBuffer.write(this.tag.toString());
        bufferArray.push(tagBuffer);

        if(this.data) {
            bufferArray.push(Parse.dataToBuffer(this.data));
        }

        return Buffer.concat(bufferArray);
    }

    getId() {
        return this.id;
    }

    getTag() {
        return this.tag;
    }

    getOwner() {
        return this.owner;
    }

    // ** type of envelop

    getType() {
        return this.type;
    }

    setType(type) {
        this.type = type;
    }

    // ** data of envelop

    getData(data) {
        return this.data;
    }

    setData(data) {
        this.data = data;
    }
}