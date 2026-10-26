# terrysense-cascade

The serving copies of the terrySense dashboard widget scripts: `shared/*.js` and `<widget>/controller.js`. ThingsBoard loads them through jsDelivr, at a URL pinned to one commit of this repository, so every push gets its own URL and no CDN purge is needed.

The source lives in logr-cloud-tool under `resources/widgets/`; nothing here is edited by hand. The repository is public, as jsDelivr serves only public repositories: never commit a secret here.

Owner: the [in-Terra-Ltd](https://github.com/in-Terra-Ltd) GitHub organisation. Push access: ask an owner of the organisation to add your GitHub account to it.

Publishing a widget change: [logr-cloud-tool README, *Publishing the widgets*](../logr-cloud-tool/README.md#publishing-the-widgets).
