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

const PortMenu = new Lang.Class({
	Name: 'PortMenu',
	Extends: PopupMenu.PopupSubMenuMenuItem,

	_init: function(parent, paconn, type){
		this.parent('', true);
		this._parent = parent;
		this._type = type;

		let children = this.actor.get_children();
		this._expandBtn = children[children.length - 1];
		for(let i = 0; i < children.length -1; i++)
			children[i].destroy();
		this.actor.remove_actor(this._expandBtn);
		this._expandBtn.hide();
		
		this._paDBus = paconn;
		this._devices = {};
		this._numPorts = 0;

		this._icon = new St.Icon({style_class: 'sink-icon'});
		let muteBtn = new St.Button({child: this._icon});
		this._slider = new Slider.Slider(0);

		//Populate all the devices
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1', type+'s']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let response = conn.call_finish(query).get_child_value(0).unpack();
				for(let i = 0; i < response.n_children(); i++){
					let devicePath = response.get_child_value(i).get_string()[0];
					this._addDevice(devicePath);
				}
			})
		);

		//Got all the devices, so lets find the default one.
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1', 'Fallback'+type]), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let response = conn.call_finish(query);
				let dSink = response.get_child_value(0).unpack().get_string()[0];
				this._setActiveDevice(this._devices[dSink]);
			})
		);

		//Laying stuff out
		this.actor.add(muteBtn);
		this.actor.add(this._slider.actor, {expand:true});
		this.actor.add(this._expandBtn);

		this.actor.add_style_class_name('stream');

		//Add listeners
		this._slider.connect('value-changed', Lang.bind(this, function(slider, value, property){
				this.setVolume(value);
			})
		);
		this._slider.connect('drag-end', Lang.bind(this, this._notifyVolumeChange));
		muteBtn.connect('clicked', Lang.bind(this, function(){
				this.setVolume(!this._activeDevice._muteVal);
			})
		);


		this._sigFall = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', 'Fallback'+type+'Updated',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onDevChange), null );
		this._sigSkA = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', 'New'+type,
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onDevChange), null );
		this._sigSkR = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', type+'Removed',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onDevChange), null );

		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));


/*
		this._sinks = {};
		this._sinks.length = 0;

		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1', 'Sinks']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let response = conn.call_finish(query);
				let sinks = response.get_child_value(0).unpack();
				for(let i = 0; i < sinks.n_children(); i++)
					this._addSink(sinks.get_child_value(i).get_string()[0]);

				this._paDBus.call(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
					GLib.Variant.new('(ss)', ['org.PulseAudio.Core1', 'FallbackSink']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
					Lang.bind(this, function(conn, query){
						let response = conn.call_finish(query);
						let dSink = response.get_child_value(0).unpack().get_string()[0];
						this._setDefaultSink(dSink);
					})
				);

			})
		);

*/


	},



	_addDevice: function(path) {
		let device = new Device(path, this._paDBus, this);
		this._devices[path] = device;
	},

	_setActiveDevice: function(dev){
		if(this._activeDevice in this._devices)
			this._activeDevice.unsetActiveDevice();

		dev.setActiveDevice();
		this._activeDevice = dev;
	},

	setVolume: function(volume){
		this._activeDevice.setVolume(volume);
	},

	_notifyVolumeChange: function() {
		global.cancel_theme_sound(VOLUME_NOTIFY_ID);
		global.play_theme_sound(VOLUME_NOTIFY_ID,
			'audio-volume-change',
			_("Volume changed"),
			Clutter.get_current_event ());
	},

	scroll: function(actor, event){
		return this._slider.scroll(event);
	},

	_setMuteIcon: function(desc){
		if(desc == 'Headphones')
			this._icon.icon_name = 'audio-headphones-symbolic';
		else if(desc == 'Digital Output (S/PDIF)' || desc == 'HDMI / DisplayPort')
			this._icon.icon_name = 'audio-card-symbolic';
		else
			this._icon.icon_name = 'audio-speakers-symbolic';

	},


	_onDevChange: function(conn, sender, object, iface, signal, param, user_data){
		let addr = param.get_child_value(0).get_string()[0];

		if(signal == 'FallbackSinkUpdated' || signal == 'FallbackSourceUpdated'){
			this._activeDevice.unsetActiveDevice();
			this._activeDevice = this._devices[addr];
			this._activeDevice.setActiveDevice();
		} 
		else if(signal == 'NewSink' || signal == 'NewSource' )
			this._addDevice(addr);
		else if(signal == 'SinkRemoved' || signal == 'SourceRemoved'){
			if(addr in this._devices){
				this._numPorts -= this._devices[addr]._numPorts;
				this._devices[addr].destroy();
				delete this._devices[addr];

				if(this._numPorts < 2)
					this._expandBtn.hide();

			}
		}
	},

	_onDestroy: function(){
		this._paDBus.signal_unsubscribe(this._sigFall);
		this._paDBus.signal_unsubscribe(this._sigSkA);
		this._paDBus.signal_unsubscribe(this._sigSkR);
	}


/*

	setVolume: function(volume){
		this.emit('fallback-updated', this._outputSink);
		if(typeof volume === 'boolean'){
			let val = GLib.Variant.new_boolean(volume);
			this._paDBus.call(null, this._outputSink, 'org.freedesktop.DBus.Properties', 'Set',
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
				this._paDBus.call(null, this._outputSink, 'org.freedesktop.DBus.Properties', 'Set',
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

			this.emit('icon-changed', this._slider.value);
		}
	},



*/











/*

	_setDefaultSink: function(sink){
		this._outputSink = sink;
		if(sink in this._sinks)
			this._sinks[sink].setOrnament(PopupMenu.Ornament.DOT);

		this._sigVol = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'VolumeUpdated',
			sink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
		this._sigMute = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'MuteUpdated',
			sink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
		this._sigPort = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'ActivePortUpdated',
			sink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onPortChanged), null );

		this._paDBus.call(null, sink, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'Volume']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let volV = conn.call_finish(query).get_child_value(0).unpack();
				this.setVolume(volV);

				this._paDBus.call(null, sink, 'org.freedesktop.DBus.Properties', 'Get',
					GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'Mute']), 
					GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
					Lang.bind(this, function(conn, query){
						let muteV = conn.call_finish(query).get_child_value(0).unpack();
						this.setVolume(muteV);
					})
				);

			})
		);	

		this._paDBus.call(null, sink, 'org.freedesktop.DBus.Properties', 'Get',			
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'ActivePort']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let pAddr = conn.call_finish(query).get_child_value(0).unpack();
				pAddr = pAddr.get_string()[0];

				this._paDBus.call(null, pAddr, 'org.freedesktop.DBus.Properties', 'Get',
					GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.DevicePort', 'Description']), 
					GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
					Lang.bind(this, function(conn, query){
						let desc = conn.call_finish(query)
						desc = desc.get_child_value(0).unpack().get_string()[0];
						this._setMuteIcon(desc);
					})
				);
			})
		);
		this.emit('fallback-updated', this._outputSink);
	},



*/

/*

	_onSinkChange: function(conn, sender, object, iface, signal, param, user_data){
		let addr = param.get_child_value(0).get_string()[0];

		if(signal == 'FallbackSinkUpdated'){
			if(this._outputSink in this._sinks)
				this._sinks[this._outputSink].setOrnament(PopupMenu.Ornament.NONE);

			this._paDBus.signal_unsubscribe(this._sigVol);
			this._paDBus.signal_unsubscribe(this._sigMute);
			this._paDBus.signal_unsubscribe(this._sigPort);

			this._setDefaultSink(addr);
		} 
		else if(signal == 'NewSink')
			this._addSink(addr);
		else if(signal == 'SinkRemoved'){
			if(addr in this._sinks){
				this._sinks[addr].destroy();
				delete this._sinks[addr];
				this._sinks.length --;
				if(this._sinks.length < 2)
					this._expandBtn.hide();

			}
		}
	},*/

/*
	_addSink: function(path){
		this._paDBus.call(null, path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'PropertyList']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this, function(conn, query){
				let response = conn.call_finish(query);
				let properties = response.get_child_value(0).unpack();
				let name = '['+path+']';

				for(let j = 0; j < properties.n_children(); j++){
					let [index, value] = properties.get_child_value(j).unpack();

					if(index.get_string()[0] == 'alsa.card_name'){
						let bytes = new Array();
						for(let k = 0; k < value.n_children(); k++)
							bytes[k] = value.get_child_value(k).get_byte();
						name = String.fromCharCode.apply(String, bytes);
						break;
					}
				}

				let item = new PopupMenu.PopupMenuItem(name);
				item.connect('activate', Lang.bind(this, this._onChangeSink));
				item._sinkPath = path;
				this.menu.addMenuItem(item);
				this._sinks[path] = item;
				this._sinks.length ++;

				if(this._sinks.length > 1)
					this._expandBtn.show();
			})
		);
	},

	_onChangeSink: function(item){
		let value = GLib.Variant.new_object_path(item._sinkPath);
		this._paDBus.call(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Set',
			GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1', 'FallbackSink', value]), null, Gio.DBusCallFlags.NONE, -1, null, null);
	},

*/

	
});

const Port = new Lang.Class({
	Name: 'PulsePort',
	Extends: PopupMenu.PopupMenuItem,

	_init: function(path, paconn, device){
		this.parent('');
		this._paDBus = paconn;
		this._path = path;
		this._device = device

		this._paDBus.call(null, path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.DevicePort', 'Description']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				this._name = conn.call_finish(query).get_child_value(0).unpack().get_string()[0];
				this.label.set_text(this.getName());
			})
		);

		this.connect('activate', Lang.bind(this._device, this._device._onPortSelect));
	},

	getName: function(){
		let name = this._device._name;
		if(this._device._numPorts > 1)
			name = name.concat(": ", this._name);
		return name;
	}



});


const Device = new Lang.Class({
	Name: 'PulseDevice',

	_init: function(path, paconn, base){
		this._paDBus = paconn;
		this._path = path;
		this._ports = {};
		this._base = base;
		this._activePort = null;

		this._sigVol = this._sigMute = this._sigPort = 0;
		this._numPorts = 0;

		this._paDBus.call(null, this._path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'PropertyList']),
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this, function(conn, query){
				let properties = conn.call_finish(query).get_child_value(0).unpack();
				let name = '['+this._path+']';

				for(let i = 0; i < properties.n_children(); i++){
					let [index, value]= properties.get_child_value(i).unpack();
					if(index.get_string()[0] == 'alsa.card_name'){
						name = new String();
						for(let j = 0; j < value.n_children() -1; j++)
							name += String.fromCharCode(value.get_child_value(j).get_byte());
						break;
					}
				}

				this._name = name;
			})
		);

		this._paDBus.call(null, this._path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'Ports']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
					let portPaths = conn.call_finish(query).get_child_value(0).unpack();
					this._numPorts = portPaths.n_children(); 
					for(let j = 0; j < this._numPorts; j++){
						let portPath = portPaths.get_child_value(j).get_string()[0];
						let port = new Port(portPath, this._paDBus, this);
						this._ports[portPath] = port;
						this._numPorts ++;
						this._base._numPorts ++;
						this._base.menu.addMenuItem(port);
						if(this._base._numPorts > 1)
							this._base._expandBtn.show();
					}
				}
			)
		);

		this._base.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},

	setActiveDevice: function(){
		this._sigVol = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'VolumeUpdated',
			this._path, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
		this._sigMute = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'MuteUpdated',
			this._path, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
		this._sigPort = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'ActivePortUpdated',
			this._path, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onPortChanged), null );

		this._paDBus.call(null, this._path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'Volume']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let volV = conn.call_finish(query).get_child_value(0).unpack();
				this.setVolume(volV);
			})
		);

		this._paDBus.call(null, this._path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'Mute']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let muteV = conn.call_finish(query).get_child_value(0).unpack();
				this.setVolume(muteV);
			})
		);

		this._paDBus.call(null, this._path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Device', 'ActivePort']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null,
			Lang.bind(this, function(conn, query){
				let response = conn.call_finish(query).get_child_value(0).unpack();
				let port = response.get_string()[0];
				this.setActivePort(this._ports[port]);
			})
		);

		this._base.emit('fallback-updated', this._path);
	},

	setActivePort: function(port){
		//Unset the currently active port
		if(this._activePort != null)
			this._activePort.setOrnament(PopupMenu.Ornament.NONE);

		this._activePort = port;
		this._activePort.setOrnament(PopupMenu.Ornament.DOT);
		this._base._setMuteIcon(this._activePort._name);
	},

	unsetActiveDevice: function(){
		this._activePort.setOrnament(PopupMenu.Ornament.NONE);
		this._activePort = null;

		this._paDBus.signal_unsubscribe(this._sigVol);
		this._paDBus.signal_unsubscribe(this._sigMute);
		this._paDBus.signal_unsubscribe(this._sigPort);

		this._sigVol = this._sigMute = this._sigPort = 0;
	},

	setVolume: function(volume){
		this._base.emit('fallback-updated', this._path);
		if(typeof volume === 'boolean'){
			let val = GLib.Variant.new_boolean(volume);
			this._paDBus.call(null, this._path, 'org.freedesktop.DBus.Properties', 'Set',
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
				this._paDBus.call(null, this._path, 'org.freedesktop.DBus.Properties', 'Set',
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

					this._base._slider.setValue(maxVal/PA_MAX);
				}
			}
			else if(type == 'b'){
				this._muteVal = volume.get_boolean();
				if(this._muteVal)
					this._base._slider.setValue(0);
				else if(this._volVariant)
					this.setVolume(this._volVariant);
			}

			this._base.emit('icon-changed', this._base._slider.value);
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
				this._base._slider.setValue(newMax / PA_MAX);
			}
		} 
		else if(signal == 'MuteUpdated'){
			this._muteVal = param.get_child_value(0).get_boolean();

			if(this._muteVal)
				this._base._slider.setValue(0);
			else {
				let max = this._volVariant.get_child_value(0).get_uint32();
				for(let i = 1; i < this._volVariant.n_children(); i++){
					let val = this._volVariant.get_child_value(i).get_uint32();
					if(max < val) max = val;
				}
				this._base._slider.setValue(max/PA_MAX);
			}
		}
		this._base.emit('icon-changed', this._base._slider.value);
	},

	_onPortChanged: function(conn, sender, object, iface, signal, param, user_data){
		let path = param.get_child_value(0).get_string()[0];
		this.setActivePort(this._ports[path]);
		/*
		this._paDBus.call(null, path, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.DevicePort', 'Description']), 
			GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this, function(conn, query){
				let resp = conn.call_finish(query);
				resp = resp.get_child_value(0).unpack().get_string()[0];
				this._base._setMuteIcon(resp);
			})
		);
*/
	},

	_onPortSelect: function(port){
		if(this._activePort != port){
			let value = GLib.Variant.new_object_path(port._path);
			this._paDBus.call(null, this._path, 'org.freedesktop.DBus.Properties', 'Set',
				GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Device', 'ActivePort', value]), null, 
				Gio.DBusCallFlags.NONE, -1, null, null);
		}

		if(this._base._activeDevice != this){
			let value = GLib.Variant.new_object_path(this._path);
			this._paDBus.call(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Set',
				GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1', 'Fallback'+this._base._type, value]), null, 
				Gio.DBusCallFlags.NONE, -1, null, null);
		}
	},

	_onDestroy: function(){
		if(this._sigVol != 0){
			this._paDBus.signal_unsubscribe(this._sigVol);
			this._paDBus.signal_unsubscribe(this._sigMute);
			this._paDBus.signal_unsubscribe(this._sigPort);
		}
	},

	destroy: function(){
		for(let p in this._ports)
			this._ports[p].destroy();
	}
});