import * as sl from 'sl';
import { Localiser, getElement } from 'sl';
import { Result, wrapRun, RunCallback, BasePage } from 'pages/interface';
import { PageSpec } from 'webrtc_pages/interface';

const plugin_name = 'StarLeafBrowserPlugin';
export var plugin_version: sl.Version;

export function PluginPage(spec: PageSpec): BasePage {
    let logger = spec.logger.sub('PLUGIN');
    let installed = false;

    enum plugin_states {
        NEED_INSTALL = 0,
        NEED_UPDATE,
        DISABLED,
        OK
    }

    let plugin_state = plugin_states.OK;

    if (webrtcDetectedType === 'plugin') {
        if (
            !AdapterJS.WebRTCPlugin.plugin &&
            AdapterJS.WebRTCPlugin.pluginState === AdapterJS.WebRTCPlugin.PLUGIN_STATES.NONE
        ) {
            logger.info('Plugin not installed yet');
            plugin_state = plugin_states.NEED_INSTALL;
        } else {
            try {
                logger.debug('plugin version = ', AdapterJS.WebRTCPlugin.plugin.VERSION);
                plugin_version = new sl.Version(AdapterJS.WebRTCPlugin.plugin.VERSION);
                let expectedVersion: sl.Version | null = null;
                if (isMac()) {
                    expectedVersion = new sl.Version(
                        SLUI_CONFIG.webrtcPlugin.safari_plugin_version
                    );
                } else if (isWindows()) {
                    expectedVersion = new sl.Version(SLUI_CONFIG.webrtcPlugin.ie_plugin_version);
                }
                if (!expectedVersion) {
                    throw 'Failed to read plugin version from config';
                }
                let compare = plugin_version.compare(expectedVersion);
                if (compare !== 0) {
                    logger.info(
                        sprintf(
                            'plugin needs %s from %s to %s',
                            compare === -1 ? 'upgrade' : 'downgrade',
                            plugin_version.str(),
                            expectedVersion.str()
                        )
                    );
                    plugin_state = plugin_states.NEED_UPDATE;
                } else {
                    plugin_state = plugin_states.OK;
                    logger.debug('Plugin is up-to-date');
                }
            } catch (ex) {
                // Happens when the plugin is installed, but disabled in the Safari options
                logger.error('Exception parsing plugin versions: ', ex);
                plugin_state = plugin_states.DISABLED;
            }
        }
    }

    let els = {
        container: sl.getElement('plugin_container'),
        link: sl.getElement<HTMLAnchorElement>('plugin_link'),
        ignore: sl.getElement('plugin_update_ignore')
    };

    let localise = function() {
        getElement('plugin_download_lbl').textContent = Dictionary['plugin_download'];
        let title = getElement('plugin_title');
        let guide = getElement('plugin_guide');
        let browser_guide =
            sl.browser_name === 'ie'
                ? Dictionary['plugin_guide_ie']
                : Dictionary['plugin_guide_safari'];
        guide.textContent = browser_guide;
        switch (plugin_state) {
            case plugin_states.NEED_INSTALL:
                title.textContent = Dictionary['plugin_install'];
                break;
            case plugin_states.NEED_UPDATE:
                title.textContent = Dictionary['plugin_update'];
                break;
            case plugin_states.DISABLED:
                title.textContent = Dictionary['plugin_blocked_safari_title'];
                guide.textContent = Dictionary['plugin_blocked_safari_guide'];
                break;
        }
    };

    function isMac() {
        return !!navigator.platform.match(/^Mac/i);
    }

    function isWindows() {
        return !!navigator.platform.match(/^Win/i);
    }

    let link = 'https://' + SLUI_CONFIG.webrtcPlugin.hostname + '/webrtcplugin/';
    if (isMac()) {
        link += SLUI_CONFIG.webrtcPlugin.safari_plugin_version + '/' + plugin_name + '.pkg';
    } else if (isWindows()) {
        link += SLUI_CONFIG.webrtcPlugin.ie_plugin_version + '/' + plugin_name + '.msi';
    }
    els.link.href = link;
    if (sl.browser_name === 'ie') {
        els.link.addEventListener('click', () => {
            window.setTimeout(() => {
                window.location.reload();
            }, 60 * 1000);
        });
    }

    function hide() {
        sl.setDisplay(els.container, false);
        sl.setDisplay(els.ignore, false);
    }

    function show() {
        sl.setDisplay(els.container, true);
    }

    function run(cb: RunCallback) {
        logger.debug('Run');
        if (plugin_state === plugin_states.OK) {
            return cb({
                result: Result.CONTINUE
            });
        } else {
            localise();
            sl.setDisplay(els.container, true);
            if (plugin_state === plugin_states.NEED_UPDATE) {
                sl.setDisplay(els.ignore, true);
                els.ignore.onclick = () => {
                    hide();
                    return cb({
                        result: Result.CONTINUE
                    });
                };
            }
        }
    }

    let that = {} as BasePage;
    that._show = show;
    that._hide = hide;
    that.run = run;
    that.localise = localise;
    that.configure = () => {};
    return that;
}
