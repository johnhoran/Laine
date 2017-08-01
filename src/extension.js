const Lang = imports.lang;
const St = imports.gi.St;
const Gvc = imports.gi.Gvc;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;
const Me = imports.misc.extensionUtils.getCurrentExtension();

const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Tweener = imports.ui.tweener;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;

const StreamMenu = Me.imports.streamMenu;
const SinkMenu = Me.imports.sinkMenu;
const SourceMenu = Me.imports.sourceMenu;
const Convenience = Me.imports.convenience;

function connectToPADBus(callback){
	let f_connectToPABus = function(paAddr, callback, moduleLoaded){
		Gio.DBusConnection.new_for_address(paAddr,
			Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null, Lang.bind(this,
				function(conn, query){
					try{
						let paConn = Gio.DBusConnection.new_for_address_finish(query);
						callback(paConn, moduleLoaded);
					} catch(e) {
						if(!moduleLoaded){
							//If the module wasn't loaded, try loading it and reconnecting
							f_loadModule(Lang.bind(this, function(){
								f_connectToPABus(paAddr, callback, true);
							}));
						} else {
							log('Laine: Cannot connect to pulseaudio over dbus');
							log(e);
						}
					}
				}
			));
	};

	let f_loadModule = function(callback){
		let [, pid] = GLib.spawn_async(null,
			['pactl','load-module','module-dbus-protocol'], null,
			GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL |
			GLib.SpawnFlags.STDERR_TO_DEV_NULL | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
			null, null
		);

		this._childWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid,
			Lang.bind(this, function(pid, status, requestObj){
				GLib.source_remove(this._childWatch);
				callback();
			})
		);
	};


	let dbus = Gio.DBus.session;
	dbus.call('org.PulseAudio1', '/org/pulseaudio/server_lookup1',
		"org.freedesktop.DBus.Properties",
		"Get", GLib.Variant.new('(ss)', ['org.PulseAudio.ServerLookup1', 'Address']),
		GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this,
			function(conn, query){
				let resp = conn.call_finish(query).get_child_value(0).unpack();
				let paAddr = resp.get_string()[0];

				f_connectToPABus(paAddr, callback, false);
			}
		)
	);
}

const LaineCore = new Lang.Class({
	Name: 'LaineCore',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(container){
		this.parent();
		this._icon = new St.Icon({ icon_name: 'system-run-symbolic', style_class: 'system-status-icon' });
 		let build_cb = function(conn, manual){
			this._paDBus = conn;
			this._moduleLoad = manual;

			this._sinkMenu = new SinkMenu.SinkMenu(this, this._paDBus);
			this._sourceMenu = new SourceMenu.SourceMenu(this, this._paDBus);
			this._streamMenu = new StreamMenu.StreamMenu(this, this._paDBus);

			this._sinkMenu.connect('icon-changed', Lang.bind(this, this._onUpdateIcon));
			this._sinkMenu.connect('fallback-updated', Lang.bind(this._streamMenu, this._streamMenu._onSetDefaultSink));
			this._sourceMenu.connect('fallback-updated', Lang.bind(this._sourceMenu, this._sourceMenu._onSetDefaultSource));

			this._setIndicatorIcon(this._sinkMenu._slider.value);
			this._addPulseAudioListeners();

			this.addMenuItem(this._sinkMenu);
			this.addMenuItem(this._sourceMenu);
			this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
			this.addMenuItem(this._streamMenu);

			container.layout();
		};

		try{
			connectToPADBus(Lang.bind(this, build_cb));
		}
		catch(e){
			log("EXCEPTION:Laine "+e);
		}
	},

	_addPulseAudioListeners: function(){
		//Stream listening
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.NewPlaybackStream', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.PlaybackStreamRemoved', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Stream.VolumeUpdated', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Stream.MuteUpdated', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);

		//Sink listening
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Device.VolumeUpdated', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Device.MuteUpdated', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Device.ActivePortUpdated', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.NewSink', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.SinkRemoved', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.FallbackSinkUpdated', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);

		//Source listening
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.NewSource', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.SourceRemoved', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.FallbackSourceUpdated', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);


		//Record listening
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.NewRecordStream', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.RecordStreamRemoved', []]),
			null, Gio.DBusCallFlags.NONE, -1, null, null);
	},

	_setIndicatorIcon: function(value){
		if(value == 0)
			this._icon.icon_name = 'audio-volume-muted-symbolic';
		else {
			let n = Math.floor(3 * value) +1;
			if (n < 2)
				this._icon.icon_name = 'audio-volume-low-symbolic';
			else if (n >= 3)
				this._icon.icon_name = 'audio-volume-high-symbolic';
			else
				this._icon.icon_name = 'audio-volume-medium-symbolic';
		}
	},

	_onUpdateIcon: function(source, value){
		this._setIndicatorIcon(value);
	},

	_getTopMenu: function(){
		return this;
	},

	/**
	 * This function is for tracking open child menus and closing an open one if
	 * a new one opens.
	 */
	_setOpenedSubMenu: function(menu){
		if(this.openChildMenu != null && this.openChildMenu.isOpen){
			this.openChildMenu.toggle();
		}

		this.openChildMenu = menu;
	},

	_onDestroy: function(){

		if(this._paDBus){
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.NewPlaybackStream']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.PlaybackStreamRemoved']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Stream.VolumeUpdated']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Stream.MuteUpdated']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Device.VolumeUpdated']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Device.MuteUpdated']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Device.ActivePortUpdated']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.NewSink']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.SinkRemoved']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.FallbackSinkUpdated']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.NewSource']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.SourceRemoved']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.FallbackSourceUpdated']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.NewRecordStream']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
				GLib.Variant.new('(s)', ['org.PulseAudio.Core1.RecordStreamRemoved']),
				null, Gio.DBusCallFlags.NONE, -1, null, null);
			/*  Unloading the module has caused pulseaudio to lose its connection to the sound card more than once, so for the sake of it
			 *	 it's probably a better idea to leave it loaded.
			 *
			if(this._moduleLoad){
				GLib.spawn_async(null, ['pactl','unload-module','module-dbus-protocol'], null,
					GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL | GLib.SpawnFlags.STDERR_TO_DEV_NULL | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
									null, null);
			}
			*/
		}
	}
});

const Laine = new Lang.Class({
	Name: 'Laine',

	_init: function(){
		this._settings = Convenience.getSettings();
		this._key_MERGE_CONTROLS = Me.imports.prefs.KEY_MERGE_CONTROLS;
		this._sigMerge = this._settings.connect(
			'changed::'+this._key_MERGE_CONTROLS,
			this._switchLayout);
		this._key_ICON_POSITION = Me.imports.prefs.KEY_ICON_POSITION;
		this._sigPosChange = this._settings.connect(
			'changed::' + this._key_ICON_POSITION,
			Lang.bind(this, this._switchEnforceIconPosition));

		this.laineCore = new LaineCore(this);
		return 0;
	},

	layout: function(){
		let merge = this._settings.get_boolean(this._key_MERGE_CONTROLS);

		let stat = false;
		if(merge)
			stat = this._aggregateLayout();
		else
			stat = this._menuButtonLayout();

		if(stat){
			Main.panel.statusArea.aggregateMenu._volume._volumeMenu.actor.hide();
			Main.panel.statusArea.aggregateMenu._volume._primaryIndicator.hide();
		}
	},

	_menuButtonLayout: function(){
		let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
		hbox.add_child(this.laineCore._icon);
		this.button = new PanelMenu.Button(0.0, "", false);
		this.button.actor.add_child(hbox);
		this.button.menu.addMenuItem(this.laineCore);
		this.button.menu.actor.add_style_class_name('solitary');

		this.button.actor.connect('destroy',
			Lang.bind(this.laineCore, this.laineCore._onDestroy)
		);
		this.button.actor.connect('scroll-event',
			Lang.bind(this.laineCore._sinkMenu, this.laineCore._sinkMenu.scroll)
		);

		if(typeof Main.panel.statusArea.laine !== 'undefined')
			delete Main.panel.statusArea.laine;
		Main.panel.addToStatusArea('laine', this.button,
			this._settings.get_boolean(this._key_ICON_POSITION) ?
			Main.panel._rightBox.get_children().length -1 : 0);
		this._sigPanelListen = Main.panel._rightBox.connect('actor-added',
			Lang.bind(this, function(){
				if(!this._settings.get_boolean(this._key_ICON_POSITION)) return;
				let container = this.button.actor.get_parent();
				let rb = Main.panel._rightBox;

				if(container == rb.get_children()[rb.get_children().length -2]) return;
				rb.remove_actor(container);
				rb.insert_child_at_index(container, rb.get_children().length -1);
			}
		));

		return true;
	},

	_aggregateLayout: function(){
		Main.panel.statusArea.aggregateMenu.menu.addMenuItem(this.laineCore, 0);
		Main.panel.statusArea.aggregateMenu._indicators.insert_child_below(
			this.laineCore._icon,
			Main.panel.statusArea.aggregateMenu._volume._primaryIndicator.get_parent()
		);
		Main.panel.statusArea.aggregateMenu._laine = this.laineCore;

		this._sigScroll = Main.panel.statusArea.aggregateMenu.actor.connect(
			'scroll-event',
			Lang.bind(this.laineCore._sinkMenu, this.laineCore._sinkMenu.scroll)
		);

		return true;
	},

	_switchLayout: function(a, b, c){
		disable();
		enable();
	},

	_switchEnforceIconPosition: function(){
		let container = this.button.actor.get_parent();
		Main.panel._rightBox.remove_actor(container);
		Main.panel._rightBox.insert_child_at_index(container,
			this._settings.get_boolean(this._key_ICON_POSITION) ?
			Main.panel._rightBox.get_children().length -1 : 0);
	},

	destroy: function(){
		if(this.button)
			this.button.destroy();
		if(Main.panel.statusArea.aggregateMenu._laine){
			this.laineCore._icon.destroy();
			this.laineCore.destroy();
			Main.panel.statusArea.aggregateMenu.actor.disconnect(this._sigScroll);
			delete Main.panel.statusArea.aggregateMenu._laine;
		}

		this._settings.disconnect(this._sigMerge);
		this._sigMerge = null;
		Main.panel._rightBox.disconnect(this._sigPanelListen);
		this._sigPanelListen = null;
	}

});


let _menuButton;

function init(){
	Convenience.initTranslations();
}

function enable(){
	global.log('loading laine');
	if(typeof Main.panel.statusArea.laine === "undefined"){
		_menuButton = null;
		_menuButton = new Laine();
	}
}

function disable(){
	_menuButton.destroy();
	Main.panel.statusArea.aggregateMenu._volume._volumeMenu.actor.show();
	Main.panel.statusArea.aggregateMenu._volume._primaryIndicator.show();
	if(Main.panel.statusArea.laine)
		delete Main.panel.statusArea.laine;
	else
		delete Main.panel.statusArea.aggregateMenu._laine;
	delete _menuButton;
}
