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


const VOLUME_NOTIFY_ID = 1;
const PA_MAX = 65536;

const SourceMenu = new Lang.Class({
	Name: 'SourceMenu',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(parent, paconn){
		this.parent();
		this._paDBus = paconn;

		let icon = new St.Icon({icon_name:'audio-input-microphone-symbolic', style_class: 'sink-icon'});
		let muteBtn = new St.Button({child: icon});
		this._slider = new Slider.Slider(0);

		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1', 'FallbackSource']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let response = conn.call_finish(query);
				let dSink = response.get_child_value(0).unpack().get_string()[0];
				this._setDefaultSource(dSink);
			})
		);

		this.actor.add(muteBtn);
		this.actor.add(this._slider.actor, {expand:true});
		this.actor.set_vertical(false);

		this.actor.add_style_class_name('stream');


		//Add signal handlers
		this._slider.connect('value-changed', Lang.bind(this, function(slider, value, property){
				this.setVolume(value);
			})
		);
		this._slider.connect('drag-end', Lang.bind(this, this._notifyVolumeChange));
    	muteBtn.connect('clicked', Lang.bind(this, function(){
    			this.setVolume(!this._muteVal);
    		})
    	);

		this._sigNewStr = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', 'NewRecordStream',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onAddStream), null );
		this._sigRemStr = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', 'RecordStreamRemoved',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onRemoveStream), null );


	},

	_setDefaultSource: function(source){
		this._inputSource = source;

		this._sigVol = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'VolumeUpdated',
			this._inputSource, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
		this._sigMute = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'MuteUpdated',
			this._inputSource, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );


		this._paDBus.call(null, source, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'Volume']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let volV = conn.call_finish(query).get_child_value(0).unpack();
				this.setVolume(volV);

				this._paDBus.call(null, source, 'org.freedesktop.DBus.Properties', 'Get',
					GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'Mute']), 
					GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
					Lang.bind(this, function(conn, query){
						let muteV = conn.call_finish(query).get_child_value(0).unpack();
						this.setVolume(muteV);
					})
				);

			})
		);	

	},

	setVolume: function(volume){
		if(typeof volume === 'boolean'){
			let val = GLib.Variant.new_boolean(volume);
			this._paDBus.call(null, this._inputSource, 'org.freedesktop.DBus.Properties', 'Set',
				GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Device', 'Mute', val]), null, 
				Gio.DBusCallFlags.NONE, -1, null, null);
		} 	
		else if(typeof volume === 'number'){
			if(volume > 1) volume = 1;
			let max = this._volVariant.get_child_value(0).get_uint32();
			for(let i = 1; i < this._volVariant.n_children(); i++){
				let val = this._volVariant.get_child_value(i).get_uint32();
				if(val > max) max = val;
			}

			let target = volume * PA_MAX;
			if(target != max){ //Otherwise no change
				let targets = new Array();
				for(let i = 0; i < this._volVariant.n_children(); i++){
					let newVal;
					if(max == 0)
						newVal = target;
					else { //To maintain any balance the user has set.
						let oldVal = this._volVariant.get_child_value(i).get_uint32();
						newVal = (oldVal/max)*target;
					}
					newVal = Math.round(newVal);
					targets[i] = GLib.Variant.new_uint32(newVal);
				}

				targets = GLib.Variant.new_array(null, targets);
				this._paDBus.call(null, this._inputSource, 'org.freedesktop.DBus.Properties', 'Set',
					GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Device', 'Volume', targets]), null, 
					Gio.DBusCallFlags.NONE, -1, null, null);
				if(this._muteVal)
					this.setVolume(false);
			}
		}
		else if(volume instanceof GLib.Variant){
			let type = volume.get_type_string();
			if(type == 'au'){
				this._volVariant = volume;
				if(!this._muteVal){
					let maxVal = volume.get_child_value(0).get_uint32();
					for(let i = 1; i < volume.n_children(); i++){
						let val = volume.get_child_value(i).get_uint32();
						if(val > maxVal) maxVal = val;
					}

					this._slider.setValue(maxVal/PA_MAX);
				}
			}
			else if(type == 'b'){
				this._muteVal = volume.get_boolean();
				if(this._muteVal)
					this._slider.setValue(0);
				else if(this._volVariant)
					this.setVolume(this._volVariant);
			}
		}
	},

	//Event handlers
	_onVolumeChanged: function(conn, sender, object, iface, signal, param, user_data){
		if(signal == 'VolumeUpdated'){
			let vals = param.get_child_value(0);
			let startV = this._volVariant;

			let oldMax = startV.get_child_value(0).get_uint32();
			let newMax = vals.get_child_value(0).get_uint32();
			for(let i = 1; i < vals.n_children; i++){
				let oVal = startV.get_child_value(i).get_uint32();
				let nVal = vals[i].get_uint32();

				if(oVal > oldMax) oldMax = oVal;
				if(nVal > newMax) newMax = nVal;
			}

			if(oldMax != newMax){ //Otherwise there is no change
				this._volVariant = vals;
				this._slider.setValue(newMax / PA_MAX);
			}
		} 
		else if(signal == 'MuteUpdated'){
			this._muteVal = param.get_child_value(0).get_boolean();

			if(this._muteVal)
				this._slider.setValue(0);
			else {
				let max = this._volVariant.get_child_value(0).get_uint32();
				for(let i = 1; i < this._volVariant.n_children(); i++){
					let val = this._volVariant.get_child_value(i).get_uint32();
					if(max < val) max = val;
				}
				this._slider.setValue(max/PA_MAX);
			}
		}
	},

	_onAddStream: function(conn, sender, object, iface, signal, param, user_data){

	},

	_onRemoveStream: function(conn, sender, object, iface, signal, param, user_data){

	},

	_notifyVolumeChange: function() {
		global.cancel_theme_sound(VOLUME_NOTIFY_ID);
		global.play_theme_sound(VOLUME_NOTIFY_ID,
			'audio-volume-change',
			_("Volume changed"),
			Clutter.get_current_event ());
	},

	_onDestroy: function(){
		this._paDBus.signal_unsubscribe(this._sigNewStr);
		this._paDBus.signal_unsubscribe(this._sigRemStr);
	}
});