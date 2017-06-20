/**
 * Created by artak on 3/2/17.
 */

export default class ActorModel {
    constructor({id, online = true, ping = 0, ghost = 0, fail = 0, stop = 0, address = null, options = {}}) {
        this.id = id;

        if(online) {
            this.setOnline();
        }

        this.address = address;
        this.pingStamp = ping;
        this.ghost = ghost;
        this.fail = fail;
        this.stop = stop;
        this.options = options;
    }

    getId() {
        return this.id;
    }

    markStopped() {
        this.stop = Date.now();
        this.setOffline();
    }

    markFailed() {
        this.fail = Date.now();;
        this.setOffline();
    }

    markGhost() {
        this.ghost = Date.now();
    }

    isGhost() {
        return this.ghost ? true : false;
    }

    isOnline() {
        return this.online ? true : false;
    }

    setOnline() {
        this.online = Date.now();
        this.ghost = false;
    }

    setOffline() {
        this.online = false;
        this.ghost = false;
    }

    ping(stamp, data) {
        this.pingStamp = stamp;
        this.ghost = false;
    }

    setAddress(address) {
       this.address = address;
    }

    getAddress () {
        return this.address;
    }

    setOptions(options) {
        this.options = options;
    }

    mergeOptions(options) {
        this.options = Object.assign(this.options, options);
        return this.options;
    }

    getOptions() {
        return this.options;
    }
}