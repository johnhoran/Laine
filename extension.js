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

let _paModuleLoaded = false;
let _paDBusConnection;
function getPADBusConnection(){
	if(_paDBusConnection) return _paDBusConnection;

	let addr = /*'unix:path=/run/user/1000/pulse/dbus-socket';//*/this.getServerAddress();
	try{
		_paDBusConnection = Gio.DBusConnection.new_for_address_sync(addr, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null);
	}
	catch(e){
		// Caught an exception, make sure pulseaudio has loaded dbus
		GLib.spawn_command_line_sync("pactl load-module module-dbus-protocol", null, null, null);
		_paDBusConnection = Gio.DBusConnection.new_for_address_sync(addr, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null);
		_paModuleLoaded = true;
	}
	return _paDBusConnection;
}

function getServerAddress(){
	let ServerLookupProxy = Gio.DBusProxy.makeProxyWrapper('<node>\
			<interface name="org.PulseAudio.ServerLookup1">\
				<property name="Address" type="s" access="read" />\
			</interface>\
		</node>');

	let conn = new ServerLookupProxy(Gio.DBus.session, 'org.PulseAudio1', '/org/pulseaudio/server_lookup1');
	let address = conn.Address;

	return address;
}


const Laine = new Lang.Class({
	Name: 'Laine',
	Extends: PanelMenu.Button,

	_init: function(){
		this.parent(0.0);
		this._paDBusConnection = getPADBusConnection();

		this._icon = new St.Icon({ icon_name: 'system-run-symbolic', style_class: 'system-status-icon' });

		let sinkMenu = new SinkMenu.SinkMenu(this._paDBusConnection);
		let streamMenu = new StreamMenu.StreamMenu(this._paDBusConnection);

		sinkMenu.connect('icon-changed', Lang.bind(this, this._onUpdateIcon));

		this._setIndicatorIcon(sinkMenu._slider.value);

		let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
		hbox.add_child(this._icon);

		this.actor.add_child(hbox);

		this.menu.addMenuItem(sinkMenu);
		this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
		this.menu.addMenuItem(streamMenu);

		this._addPulseAudioListeners();
		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
		this.actor.connect('scroll-event', Lang.bind(sinkMenu, sinkMenu.scroll));
		return 0;
	},

	_addPulseAudioListeners: function(){
		//Stream listening
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.NewPlaybackStream', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.PlaybackStreamRemoved', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Stream.VolumeUpdated', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Stream.MuteUpdated', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);

		//Sink listening
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Device.VolumeUpdated', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Device.MuteUpdated', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.Device.ActivePortUpdated', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.NewSink', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.SinkRemoved', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'ListenForSignal',
			GLib.Variant.new('(sao)', ['org.PulseAudio.Core1.FallbackSinkUpdated', []]),  
			null, Gio.DBusCallFlags.NONE, -1, null);
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

	_onDestroy: function(){
		//Possibly this should only be done when we loaded the pa dbus module ourselves, otherwise it is possible that another applications
		//is listenening on this signals, don't know if there is anyway of checking if this is the case.
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.NewPlaybackStream']),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.PlaybackStreamRemoved']),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Stream.VolumeUpdated']),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Stream.MuteUpdated']),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Device.VolumeUpdated']),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Device.MuteUpdated']),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.Device.ActivePortUpdated']),  
			null, Gio.DBusCallFlags.NONE, -1, null);		
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.NewSink']),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.SinkRemoved']),  
			null, Gio.DBusCallFlags.NONE, -1, null);
		this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'StopListeningForSignal',
			GLib.Variant.new('(s)', ['org.PulseAudio.Core1.FallbackSinkUpdated']),  
			null, Gio.DBusCallFlags.NONE, -1, null);

		if(_paModuleLoaded){
			_paDBusConnection = null;
			GLib.spawn_command_line_sync("pactl unload-module module-dbus-protocol", null, null, null);
		}
	}


});

let _menuButton;

function init(){}

function enable(){
	_menuButton = new Laine();
	Main.panel.addToStatusArea('laine', _menuButton);
	Main.panel.statusArea.aggregateMenu._volume._volumeMenu.actor.hide();
	Main.panel.statusArea.aggregateMenu._volume._primaryIndicator.hide();
}

function disable(){
	_menuButton.destroy();
	Main.panel.statusArea.aggregateMenu._volume._volumeMenu.actor.show();
	Main.panel.statusArea.aggregateMenu._volume._primaryIndicator.show();
}