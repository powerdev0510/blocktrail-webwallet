(function () {
    "use strict";

    angular.module("blocktrail.wallet")
        .controller("WalletCtrl", WalletCtrl);

    function WalletCtrl($scope, $state, $rootScope, $interval, walletsManagerService, activeWallet, sdkService,
                        CONFIG, settingsService, setupService, $timeout, launchService, blocktrailLocalisation,
                        dialogService, $translate, Currencies, AppVersionService, Contacts, $filter, trackingService,
                        glideraService) {

        $scope.settings = settingsService.getReadOnlySettings();
        $scope.walletData = activeWallet.getReadOnlyWalletData();

        $scope.$watch('walletData.networkType', function() {
            glideraService.init();
        });

        $scope.sideNavList = [
            {
                stateHref: $state.href("app.wallet.summary"),
                activeStateName: "app.wallet.summary",
                linkText: "MY_WALLET",
                linkIcon: "bticon-doc-text",
                isHidden: false
            },
            {
                stateHref: $state.href("app.wallet.send"),
                activeStateName: "app.wallet.send",
                linkText: "SEND",
                linkIcon: "bticon-forward-outline",
                isHidden: false
            },
            {
                stateHref: $state.href("app.wallet.receive"),
                activeStateName: "app.wallet.receive",
                linkText: "RECEIVE",
                linkIcon: "bticon-reply-outline",
                isHidden: false
            },
            {
                stateHref: $state.href("app.wallet.buybtc.choose"),
                activeStateName: "app.wallet.buybtc",
                linkText: "BUYBTC_NAVTITLE",
                linkIcon: "bticon-credit-card",
                isHidden: !CONFIG.NETWORKS[$scope.walletData.networkType].BUYBTC
            },
            {
                stateHref: $state.href("app.wallet.settings"),
                activeStateName: "app.wallet.settings",
                linkText: "SETTINGS",
                linkIcon: "bticon-cog",
                isHidden: false
            }
        ];
        $scope.appStoreButtonsData = {
            config: CONFIG,
            settings: $scope.settings
        };

        $scope.isLoadingNewWallet = false;

        // track when wallet is activated (first time > 0 balance)
        if (!$scope.settings.walletActivated) {
            var walletActivatedInterval = $interval(function() {
                if ($scope.walletData.balance + $scope.walletData.uncBalance > 0) {
                    settingsService.updateSettingsUp({walletActivated: true});
                    trackingService.trackEvent(trackingService.EVENTS.ACTIVATED);

                    $interval.cancel(walletActivatedInterval);
                }
            }, 60000);
        }

        /**
         * Start temporal implementation for multiple wallets
         * TODO Add select to template
         */
        $scope.debugMode = CONFIG.DEBUG;

        $scope.sdkActiveNetwork = sdkService.getReadOnlySdkData().networkType;
        $scope.activeWalletUniqueIdentifier = $scope.walletData.uniqueIdentifier;
        $scope.walletsListOptions = prepareWalletListOptions(walletsManagerService.getWalletsList());

        function prepareWalletListOptions(walletsList) {
            var list = [];

            walletsList.forEach(function(wallet) {
                list.push({
                    value: wallet.uniqueIdentifier,
                    label: CONFIG.NETWORKS[wallet.network].NETWORK_LONG,
                    wallet: wallet
                })
            });

            return list;
        }

        $scope.onClickSetActiveWallet = function(uniqueIdentifier) {
            if(uniqueIdentifier === $scope.walletData.uniqueIdentifier) {
                return;
            }

            $scope.isLoadingNewWallet = true;

            walletsManagerService.setActiveWalletByUniqueIdentifier(uniqueIdentifier)
                .then(function() {
                    $scope.isLoadingNewWallet = false;
                    $state.reload();
                });
        };

        // add info from setup process to the settings
        setupService.getUserInfo().then(function(userInfo) {
            if (userInfo.username || userInfo.displayName || userInfo.email) {
                var updateSettings = {
                    username: userInfo.username || $scope.settings.username,
                    displayName: userInfo.displayName || $scope.settings.displayName,
                    email: userInfo.email || $scope.settings.email
                };

                setupService.clearUserInfo();
                settingsService.updateSettingsUp(updateSettings);
            }
        }, function(e) {
            console.error('getUserInfo', e);
        });

        $scope.$on('glidera_complete', function(event, transaction) {
            dialogService.alert({
                body: $translate.instant('MSG_BUYBTC_GLIDERA_COMPLETE_BODY', {
                    qty: transaction.qty
                }),
                title: 'MSG_BUYBTC_GLIDERA_COMPLETE'
            })
        });

        /**
         * Fetch extra languages
         *
         * Check for extra languages to enable, if one is preferred, prompt user to switch
         *
         * TODO move the logic to service
         */
        $rootScope.fetchExtraLanguages = launchService.getWalletConfig()
            .then(function(result) {
                settingsService.getSettings().then(function(settings) {
                    // check if we need to display any update notices
                    AppVersionService.checkVersion(settings.latestVersionWeb, result.versionInfo.web, AppVersionService.CHECKS.LOGGEDIN);

                    // store the latest version we've used
                    if (!settings.latestVersionWeb || semver.gt(CONFIG.VERSION, settings.latestVersionWeb)) {
                        $timeout(function() {
                            var updateSettings = {
                                latestVersionWeb: CONFIG.VERSION
                            };

                            settingsService.updateSettingsUp(updateSettings);
                        }, 500);
                    }
                });

                if (result.currencies) {
                    result.currencies.forEach(function (currency) {
                        Currencies.enableCurrency(currency);
                    });
                }

                return result.extraLanguages.concat(CONFIG.EXTRA_LANGUAGES).unique();
            })
            .then(function(extraLanguages) {
                return settingsService.getSettings().then(function(settings) {
                    (settings.extraLanguages || []).forEach(function(language) {
                        blocktrailLocalisation.enableLanguage(language);
                    });

                    // determine (new) preferred language
                    var r = blocktrailLocalisation.parseExtraLanguages(extraLanguages);

                    if (r) {
                        var newLanguages = r[0];
                        var preferredLanguage = r[1];

                        // store extra languages
                        var updateSettings = {
                            extraLanguages: settings.extraLanguages.concat(newLanguages).unique()
                        };

                        return settingsService.updateSettingsUp(updateSettings)
                            .then(function(settings) {
                                // check if we have a new preferred language
                                if (preferredLanguage && settings.language && preferredLanguage !== settings.language && extraLanguages.indexOf(preferredLanguage) !== -1) {
                                    // prompt to enable
                                    return dialogService.prompt({
                                        body: $translate.instant('MSG_BETTER_LANGUAGE', {
                                            oldLanguage: $translate.instant(blocktrailLocalisation.languageName(settings.language)),
                                            newLanguage: $translate.instant(blocktrailLocalisation.languageName(preferredLanguage))
                                        }),
                                        title: $translate.instant('MSG_BETTER_LANGUAGE_TITLE'),
                                        prompt: false
                                    })
                                        .result
                                        .then(function() {
                                            // enable new language
                                            var updateSettings = {
                                                extraLanguages: preferredLanguage
                                            };
                                            // TODO root scope language should have a subscription on property language from settings service
                                            $rootScope.changeLanguage(preferredLanguage);
                                            return settingsService.updateSettingsUp(updateSettings);
                                        });
                                }
                            });
                    }
                });
            })
            .then(
                function() {},
                function(e) {
                    console.error('extraLanguages', e && (e.msg || e.message || "" + e));
                }
            );


        $rootScope.getPrice = function() {
            return Currencies.updatePrices(false)
                .then(function(prices) {
                    $rootScope.bitcoinPrices = prices;
                });
        };

        $rootScope.syncContacts = function() {
            //sync any changes to contacts
            Contacts.list()
                .catch(function(err) {
                    $log.error(err);
                });
         };

        // do initial updates then poll for changes, all with small offsets to reducing blocking / slowing down of rendering
        $timeout(function() {
            $rootScope.syncContacts();
        }, 500);

        $timeout(function() {
            $rootScope.getPrice();
        }, 1000);

        // TODO settings polling move to a settingsService
        $timeout(function() {
            settingsService.syncSettingsDown();
        }, 302000); // 5 min + slight offset not to collide
    }
})();
