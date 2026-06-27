const {
    contextBridge,
    ipcRenderer
} = require("electron");

// One-shot migration: when the main process determines this is the first
// launch with the new defaultAdaptiveColors behaviour, it passes the chosen
// mode here via webPreferences.additionalArguments. We seed it into the
// drawio Configuration JSON in localStorage (key '.configuration') so that
// Editor.configure() picks it up during App.js boot. We never overwrite an
// explicit value the user may have already set via Extras > Configuration.
try
{
	const flagPrefix = '--initial-adaptive-colors=';
	const flagArg = process.argv.find(a => a.startsWith(flagPrefix));

	if (flagArg)
	{
		const mode = flagArg.slice(flagPrefix.length);

		if (mode === 'auto' || mode === 'simple' || mode === 'none')
		{
			const raw = window.localStorage.getItem('.configuration');
			const cfg = raw ? JSON.parse(raw) : {};

			if (cfg.defaultAdaptiveColors == null)
			{
				cfg.defaultAdaptiveColors = mode;
				window.localStorage.setItem('.configuration', JSON.stringify(cfg));
			}
		}
	}
}
catch (e)
{
	// Don't block app startup if the migration fails for any reason.
	console.error('Failed to seed defaultAdaptiveColors:', e);
}

let reqId = 1;
let reqInfo = {};
let fileChangedListeners = {};

ipcRenderer.on('mainResp', (event, resp) => 
{
	var callbacks = reqInfo[resp.reqId];
	
	if (callbacks)
	{
		if (resp.error)
		{
			if (typeof callbacks.error === 'function')
			{
				callbacks.error(resp.msg, resp.e);
			}
		}
		else
		{
			if (typeof callbacks.callback === 'function')
			{
				callbacks.callback(resp.data);
			}
		}
	}
	
	delete reqInfo[resp.reqId];
});

ipcRenderer.on('fileChanged', (event, resp) => 
{
	var listener = fileChangedListeners[resp.path];
	
	if (listener)
	{
		listener(resp.curr, resp.prev);
	}
});

contextBridge.exposeInMainWorld(
    'electron', {
        request: (msg, callback, error) => 
		{
			msg.reqId = reqId++;
			reqInfo[msg.reqId] = {callback: callback, error: error};

			//TODO Maybe a special function for this better than this hack?
			//File watch special case where the callback is called multiple times
			if (msg.action == 'watchFile')
			{
				fileChangedListeners[msg.path] = msg.listener;
				delete msg.listener;
			}

			ipcRenderer.send('rendererReq', msg);
        },
		registerMsgListener: function(action, callback)
		{
			ipcRenderer.on(action, function(event, args)
			{
				callback(args);
			});
		},
		sendMessage: function(action, args)
		{
			ipcRenderer.send(action, args);
		},
		listenOnce: function(action, callback)
		{
			ipcRenderer.once(action, function(event, args)
			{
				callback(args);
			});
		}
    }
);

contextBridge.exposeInMainWorld(
    'process', {
		type: process.type,
		versions: process.versions
	}
);

/* ==========================================
 *   🚀 DrawIQ 运行时 Loading 颜色第二确认防线
 * ========================================== */
document.addEventListener('DOMContentLoaded', () => 
{
	try
	{
		const geInfo = document.getElementById('geInfo');
		if (geInfo)
		{
			let isDark = false;
			let hasExplicitPreference = false;

			try
			{
				const configRaw = window.localStorage.getItem('.drawio-config');
				if (configRaw)
				{
					const config = JSON.parse(configRaw);
					if (config.darkMode === true)
					{
						isDark = true;
						hasExplicitPreference = true;
					}
					else if (config.darkMode === false)
					{
						isDark = false;
						hasExplicitPreference = true;
					}
				}
			}
			catch (e) {}

			if (!hasExplicitPreference)
			{
				if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
				{
					isDark = true;
				}
			}

			// 强力覆写已有 Loading 的底色和文字颜色
			geInfo.style.backgroundColor = isDark ? '#202020' : '#f5f5f5';
			const geInfoText = document.getElementById('geInfoText');
			if (geInfoText)
			{
				geInfoText.style.color = isDark ? '#aaaaaa' : '#666666';
			}
		}
	}
	catch (e)
	{
		console.error('Failed to run secondary loading theme check:', e);
	}
});
