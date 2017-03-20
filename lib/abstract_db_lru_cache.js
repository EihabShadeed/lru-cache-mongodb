/**
 * Created by Ali Ismael on 11/29/2015.
 */
"use strict";

let LRUCacheFactory = require("lru-cache-js"),
    Q = require("q");

let DATE_LAST_UPDATED_FILED_NAME = "date_last_updated";

/**
 *
 */
class AbstractDatabaseBackedLRUCache {

    /**
     *
     * @param instanceName
     * @param dbCollectionName
     * @param cacheEntryFactory
     * @param evictionNotificationCallback
     */
    constructor(dbMgr, maxCacheSize,  updatePeriodMillis, instanceName, dbCollectionName, cacheEntryFactory, evictionNotificationCallback) {

        if (!instanceName || (typeof instanceName !== "string")) {
            throw new Error("instance name must be a valid string");
        }

        if (!dbCollectionName || (typeof dbCollectionName !== "string")) {
            throw new Error("dbCollectionName name must be a valid string");
        }

        if (!cacheEntryFactory || (typeof cacheEntryFactory !== "function")) {
            throw new Error("cacheEntryFactory name must be a valid function");
        }

        if (!evictionNotificationCallback || (typeof evictionNotificationCallback !== "function")) {
            throw new Error("evictionNotificationCallback name must be a valid function");
        }
        this.updatePeriodMillis = updatePeriodMillis;
        this.maxCacheSize = maxCacheSize;
        this.dbMgr = dbMgr;

        this.__isDatabaseContentUpdated = this.__isDatabaseContentUpdated.bind(this);
        this.__checkForUpdates = this.__checkForUpdates.bind(this);
        this.get = this.get.bind(this);
        this.__evictEntries = this.__evictEntries.bind(this);
        this.clear = this.clear.bind(this);

        this.dbCollectionName = dbCollectionName;
        this.cacheEntryFactory = cacheEntryFactory;
        this.lastTimeDbUpdated = 0;
        this.mostRecentDBRecordDateAcknowledged = new Date(0);
        this.innerLRUCache = new LRUCacheFactory(maxCacheSize, evictionNotificationCallback);
    }

    /**
     *
     * @returns {*}
     * @private
     */
    __isDatabaseContentUpdated() {
        return Q.Promise((resolve) => {
            this.dbMgr.find(this.dbCollectionName, {}, {
                limit: 1,
                sort: [
                    [DATE_LAST_UPDATED_FILED_NAME, -1]
                ]
            }).then((items) => {
                if (items.length === 0) {
                    return resolve(false);
                }
                let item = items[0];
                if (item[DATE_LAST_UPDATED_FILED_NAME].getTime() > this.mostRecentDBRecordDateAcknowledged.getTime()) {
                    this.clear();
                    this.mostRecentDBRecordDateAcknowledged = item[DATE_LAST_UPDATED_FILED_NAME];
                    resolve(true);
                } else {
                    resolve(false);
                }
            }).catch((err) => {
                resolve(false);
            });
        });
    }

    /**
     *
     * @returns {*}
     * @private
     */
    __checkForUpdates() {
        let nowTime = new Date().getTime();
        let elapsedTimeSinceLastUpdate = nowTime - this.lastTimeDbUpdated;

        if (elapsedTimeSinceLastUpdate > this.updatePeriodMillis) {
            this.lastTimeDbUpdated = nowTime;
            return this.__isDatabaseContentUpdated();
        } else {
            //nothing to do in the middle of a db change check period.
            return Q.resolve(false);
        }
    }

    /**
     *
     * @param query
     */
    get(query) {

        let __innerGet = () => {
            return Q.Promise((resolve, reject) => {
                let retVal = this.innerLRUCache.get(query);

                if (!retVal) {
                    //load the resource from the database:
                    this.dbMgr.find(this.dbCollectionName, query, {limit: 1}).then((dbCacheEntry) => {
                        //add the resource to the cache:
                        try {
                            retVal = this.cacheEntryFactory(dbCacheEntry);
                            if(retVal) {
                                this.innerLRUCache.put(query, retVal);
                                return resolve(retVal);
                            } else {
                                let error = new Error("cacheEntryFactory failed to create an entry for:" + query);
                                return reject(error);
                            }
                        } catch (err) {
                            return reject(err);
                        }
                    }).catch(reject);
                } else {
                    resolve(retVal);
                }
            });
        };

        return [this.__checkForUpdates, __innerGet].reduce(Q.when, Q());
    }

    /**
     *
     * @param items
     * @private
     */
    __evictEntries(items) {
        /**
         * TODO: the abstract cache need to be optimized to evict only the items in the database
         * which have been updated.
         */
    }

    /**
     *
     */
    clear() {
        this.innerLRUCache.clear();
    }

}

module.exports = AbstractDatabaseBackedLRUCache;
