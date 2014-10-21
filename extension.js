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

function connectToPADBus(callback){
	let dbus = Gio.DBus.session;

	dbus.call('org.PulseAudio1', '/org/pulseaudio/server_lookup1', "org.freedesktop.DBus.Properties", "Get",
		GLib.Variant.new('(ss)', ['org.PulseAudio.ServerLookup1', 'Address']), GLib.VariantType.new("(v)"),
		Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this, function(conn, query){
			let resp = conn.call_finish(query);
			resp = resp.get_child_value(0).unpack();
			let paAddr = resp.get_string()[0];

			Gio.DBusConnection.new_for_address(paAddr, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null, 
				Lang.bind(this, function(conn, query){
					try{
						let paConn = Gio.DBusConnection.new_for_address_finish(query);
						callback(paConn, false);
					} catch(e) {
						//Couldn't connect to PADBus, try manually loading the module and reconnecting
						let [, pid]  = GLib.spawn_async(null, ['pactl','load-module','module-dbus-protocol'], null,
							GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL | GLib.SpawnFlags.STDERR_TO_DEV_NULL | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
								null, null);

						this._childWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, Lang.bind(this, function(pid, status, requestObj) {
							GLib.source_remove(this._childWatch);

							Gio.DBusConnection.new_for_address(paAddr, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null, 
								Lang.bind(this, function(conn, query){
									try{
										let paConn = Gio.DBusConnection.new_for_address_finish(query);
										callback(paConn, true);
									} catch(e) {
										log('Laine: Cannot connect to pulseaudio over dbus');
										throw e;
									}
								})
							);
						}));
					}
				})
			);
		})
	);
}



const Laine = new Lang.Class({
	Name: 'Laine',
	Extends: PanelMenu.Button,

	_init: function(){
		this.parent(0.0);

		this._icon = new St.Icon({ icon_name: 'system-run-symbolic', style_class: 'system-status-icon' });

		let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
		hbox.add_child(this._icon);

		this.actor.add_child(hbox);

		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

		connectToPADBus(Lang.bind(this, function(conn, manual){
			this._paDBus = conn;
			this._moduleLoad = manual;

			let sinkMenu = new SinkMenu.SinkMenu(this, this._paDBus);
			let sourceMenu = new SourceMenu.SourceMenu(this, this._paDBus);
			let streamMenu = new StreamMenu.StreamMenu(this, this._paDBus);

			sinkMenu.connect('icon-changed', Lang.bind(this, this._onUpdateIcon));
			sinkMenu.connect('fallback-updated', Lang.bind(streamMenu, streamMenu._onSetDefaultSink));

			this._setIndicatorIcon(sinkMenu._slider.value);
			this._addPulseAudioListeners();

			this.menu.addMenuItem(sinkMenu);
			this.menu.addMenuItem(sourceMenu);
			this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
			this.menu.addMenuItem(streamMenu);

			this.actor.connect('scroll-event', Lang.bind(sinkMenu, sinkMenu.scroll));

			//Everything good up to this point, lets replace the built in sound indicator
			Main.panel.addToStatusArea('laine', this);
			Main.panel.statusArea.aggregateMenu._volume._volumeMenu.actor.hide();
			Main.panel.statusArea.aggregateMenu._volume._primaryIndicator.hide();
		}));

		return 0;
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
		return menu;
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

let _menuButton;

function init(){}

function enable(){
	_menuButton = new Laine();
}

function disable(){
	_menuButton.destroy();
	Main.panel.statusArea.aggregateMenu._volume._volumeMenu.actor.show();
	Main.panel.statusArea.aggregateMenu._volume._primaryIndicator.show();
}