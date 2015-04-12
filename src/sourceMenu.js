const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Atk = imports.gi.Atk;
const Clutter = imports.gi.Clutter;

const BoxPointer = imports.ui.boxpointer;
const Slider = imports.ui.slider;
const PopupMenu = imports.ui.popupMenu;
const Signals = imports.signals;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const PortMenu = Me.imports.portMenu;

const SourceMenu = new Lang.Class({
	Name: 'SourceMenu',
	Extends: PortMenu.PortMenu,

	_init: function(parent, paconn) {
		this.parent(parent, paconn, 'Source');

		this._streams = new Array();

		//Get already existing streams
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1', 'RecordStreams']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null, 
			Lang.bind(this, function(conn, query){
				let response = conn.call_finish(query).get_child_value(0).unpack();
				for(let i = 0; i < response.n_children(); i++)
					this._addStream(response.get_child_value(i).get_string()[0]);
			})
		);
		this._updateVisibility();

		this._sigNewStr = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', 'NewRecordStream',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, function(conn, sender, object, iface, signal, param, user_data){
				let streamPath = param.get_child_value(0).unpack();
				this._addStream(streamPath);
			}), null );
		this._sigNewStr = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', 'RecordStreamRemoved',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onRemoveStream), null );

		this.connect('fallback-updated', Lang.bind(this, this._onSetDefaultSource));
		this.actor.connect('destroy', Lang.bind(this, this._onSubDestroy));
	},

	_addStream: function(path) {
		this._paDBus.call(null, path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', 'ResampleMethod']),
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null, 
			Lang.bind(this, function(conn, query){
				let response = conn.call_finish(query).get_child_value(0).unpack();

				let rsMethod = response.get_string()[0];
				if(rsMethod != 'peaks'){ //Disregard peak resample methods, as these aren't the record streams we are looking for.
					this._streams.push(path);
					this._updateVisibility();
				}
			})
		);
	},

	_onRemoveStream: function(conn, sender, object, iface, signal, param, user_data) {
		let path = param.get_child_value(0).unpack();
		let index = this._streams.indexOf(path);
		if(index != -1){
			this._streams.splice(index, 1);
			this._updateVisibility();
		}

	},


	_setMuteIcon: function(desc){
		this._icon.icon_name = 'audio-input-microphone-symbolic';
	},

	_isExpandBtnVisible: function(){
		let num = 0;
		for(let d in this._devices){
			num += this._devices[d]._numPorts;
			if(num > 0){
				return true;
			}
		}  

		return false;
	},

	_isVisible: function(){
		return (this._streams.length > 0);
	},

	_onSetDefaultSource: function(src, source){
		for(let s in this._streams){
			this._paDBus.call(null, this._streams[s], 'org.PulseAudio.Core1.Stream', 'Move',
				GLib.Variant.new('(o)', [source]), null, Gio.DBusCallFlags.NONE, -1, null, null);
		}
	},

	_onSubDestroy: function(){
		this._paDBus.signal_unsubscribe(this._sigNewStr);
		this._paDBus.signal_unsubscribe(this._sigRemStr);
	}

});
