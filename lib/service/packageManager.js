var Promise = require('bluebird');

var repoCacheHandler = require('./repoCaches/repoCacheHandler');
var privatePackageStore = require('./packageStores/privatePackageStore');
var publicPackageStore = require('./packageStores/publicPackageStore');

var config = require('../infrastructure/configurationManager').config;

module.exports = function PackageManager() {

    function _getPrivatePackages() {
        var packages = [];

        for(var packageName in privatePackageStore.packages) {
            if(privatePackageStore.packages.hasOwnProperty(packageName)) {
                var item = privatePackageStore.packages[packageName];
    
                packages.push({
                    name: item.name,
                    url: item.url,
                    hits: item.hits
                });
            }
        }
        
        return packages;
    }
    
    function _registerPackages(packages) {
        privatePackageStore.registerPackages(packages);
    }
    
    function _removePackages(packages) {
        privatePackageStore.removePackages(packages);

        if(repoCacheHandler.enabled) {
            repoCacheHandler.removePackages(packages);
        }
    }
    
    function _searchPackage(searchName) {
        var packages = privatePackageStore.searchPackage(searchName);

        if(!config.public.disabled) {
            var publicPackages = publicPackageStore.searchPackage(searchName);

            publicPackages = filterOnlyWhitelist(publicPackages);

            publicPackages = filterBlacklist(publicPackages);
    
            packages = packages.concat(publicPackages);
        }
        
        return packages;

        function filterOnlyWhitelist(list) {
            if(!config.public.whitelist.enabled) {
                return list;
            }

            return list.filter(function(packageName) {
                return config.public.whitelist.indexOf(packageName) > -1;
            });
        }

        function filterBlacklist(list) {
            if(!config.public.blacklist.enabled) {
                return list;
            }

            return list.filter(function(packageName) {
                return config.public.blacklist.indexOf(packageName) === -1;
            });
        }
    }
    
    //TODO: should refactor this
    function _getPackageForInstall(packageName) {
        return new Promise(function(resolve, reject) {
            var privatePackage = privatePackageStore.getPackage(packageName);
        
            if(privatePackage) {
                handlePrivatePackage();
            }
            else if(canHandlePublicPackage()) {
                handlePublicPackage();
            }
            else {
                reject();
            }

            function canHandlePublicPackage() {
                var isValidByWhitelist = config.public.whitelist.indexOf(packageName) > -1;
                var notExcludedByBlacklist = config.public.blacklist.indexOf(packageName) !== -1;

                return !config.public.disabled && isValidByWhitelist && notExcludedByBlacklist;
            }
        
            function handlePrivatePackage() {
                if(config.repositoryCache && config.repositoryCache.cachePrivate) {
                    if(privatePackage.cachedRepo) {
                        resolve({
                            name: packageName,
                            url: privatePackage.cachedRepo,
                            hits: privatePackage.hits
                        });
                    }
                    else if(repoCacheHandler) {
                        cachePrivateRepoAndSend();
                    }
                    else {
                        sendPrivatePackage();
                    }
                }
                else {
                    sendPrivatePackage();
                }
        
                function cachePrivateRepoAndSend() {
                    var repoCache = repoCacheHandler.getRepoCache(privatePackage.url);
        
                    repoCache.cacheRepo(packageName, privatePackage.url)
                        .then(function(pack) {
                            privatePackage.cachedRepo = pack.url;
                            privatePackageStore.persistPackages();
        
                            resolve({
                                name: packageName,
                                url: privatePackage.cachedRepo,
                                hits: privatePackage.hits
                            });
                        })
                        .catch(sendPrivatePackage);
                }
        
                function sendPrivatePackage() {
                    resolve({
                        name: packageName,
                        url: privatePackage.url,
                        hits: privatePackage.hits
                    });
                }
            }
        
            function handlePublicPackage() {
                var publicPackage = publicPackageStore.getPackage(packageName);
                if(publicPackage) {
                    if(repoCacheHandler.enabled) {
                        cachePublicRepo();
                    }
                    else {
                        resolve(publicPackage);
                    }
                }
                else {
                    reject();
                }
        
                function cachePublicRepo() {
                    var repoCache = repoCacheHandler.getRepoCache(publicPackage.url);
        
                    repoCache.cacheRepo(packageName, publicPackage.url)
                        .then(function(pack) {
                            var privatePackage = {
                                name: packageName,
                                url: pack.url,
                                hits: publicPackage.hits
                            };
        
                            privatePackageStore.registerPackages([ privatePackage ]);
        
                            resolve({
                                name: privatePackage.name,
                                url: privatePackage.url,
                                hits: privatePackage.hits
                            });
                        })
                        .catch(function() {
                            resolve(publicPackage);
                        });
                }
            }
        });
    }
    
    return {
        removePackages: _removePackages,
        searchPackage: _searchPackage,
        registerPackages: _registerPackages,
        getPrivatePackages: _getPrivatePackages,
        getPackageForInstall: _getPackageForInstall
    };
}();