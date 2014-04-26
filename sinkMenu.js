const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Atk = imports.gi.Atk;
const Clutter = imports.gi.Clutter;

const BoxPointer = imports.ui.boxpointer;
const Slider = imports.ui.slider;

const PA_MAX = 65536;

const SinkMenu = new Lang.Class({
	Name:'SinkMenu',
	Extends: PopupMenu.PopupSubMenuMenuItem,

	_init: function(paconn){
		this.parent('', true);

		let children = this.actor.get_children();
		this._expandBtn = children[children.length - 1];
		for(let i = 0; i < children.length -1; i++)
			children[i].destroy();
		this.actor.remove_actor(this._expandBtn);

		this._paDBusConnection = paconn;
		this._sinks = {};
		this._sinks.length = 0;

		let sinks = this.getCurrentSinks();
		for(let i = 0; i < sinks.length; i++){
			let name = this._getPAProperty(sinks[i], 'org.PulseAudio.Core1.Device', 'Name');
			name = name.get_string()[0];

			let item = new PopupMenu.PopupMenuItem(name);
			item._sinkPath = sinks[i];
			this.menu.addMenuItem(item);
			this._sinks[sinks[i]] = item;
			this._sinks.length ++;
		}
		if(this._sinks.length < 2)
			this._expandBtn.hide();

		this._outputSink = this.getDefaultSink();

		this._icon = new St.Icon({style_class: 'sink-icon'});
		let muteBtn = new St.Button({child: this._icon});

		let pDesc = this.getPortDescription();
		if(pDesc == 'Headphones')
			this._icon.icon_name = 'audio-headphones-symbolic';
		else if(pDesc == 'Digital Output (S/PDIF)')
			this._icon.icon_name = 'audio-card-symbolic';
		else
			this._icon.icon_name = 'audio-speakers-symbolic';

		let vol = this.getVolume();
		let mute = this.getMute();
		if(mute) vol = 0;
		this._slider = new Slider.Slider(vol);

		//Laying stuff out
		this.actor.add(muteBtn);
		this.actor.add(this._slider.actor,{expand:true});
		this.actor.add(this._expandBtn);

		this.actor.add_style_class_name('stream');

		//Add listeners
		this._slider.connect('value-changed', Lang.bind(this, this._onSliderChanged));
    	muteBtn.connect('clicked', Lang.bind(this, this._onMuteClick));

		this._volSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'VolumeUpdated',
			this._outputSink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
		this._muteSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'MuteUpdated',
			this._outputSink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
		this._portSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'ActivePortUpdated',
			this._outputSink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onPortChanged), null );
		this._falSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1', 'FallbackSinkUpdated',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onSinkChange), null );
		this._skaSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1', 'NewSink',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onSinkChange), null );
		this._skrSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1', 'SinkRemoved',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onSinkChange), null );
		
	},

	getCurrentSinks: function(){
		let sinks = new Array();
		let sinkVar = this._getPAProperty('/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'Sinks');
		if(sinkVar != null){
			for(let i = 0; i < sinkVar.n_children(); i++)
				sinks[i] = sinkVar.get_child_value(i).get_string()[0];
		}
		return sinks;
	},

	getDefaultSink: function(){
		let sinkVar = this._getPAProperty('/org/pulseaudio/core1', 'org.PulseAudio.Core1', 'FallbackSink');
		if(sinkVar == null) return '';
		return sinkVar.get_string()[0];
	},

	getVolume: function(){
		let volVar = this._getPAProperty(this._outputSink, 'org.PulseAudio.Core1.Device', 'Volume');
		this._volVariant = volVar; //To maintain balance
		if(volVar == null) return 0;

		let maxVal = volVar.get_child_value(0).get_uint32();
		for(let i = 1; i < volVar.n_children(); i++){
			let val = volVar.get_child_value(i).get_uint32();
			if(val > maxVal) maxVal = val;
		}

		return maxVal/PA_MAX;
	},

	getMute: function(){
		let mVar = this._getPAProperty(this._outputSink, 'org.PulseAudio.Core1.Device', 'Mute');
		this._muteVal = mVar.get_boolean();
		return this._muteVal;
	},

	getPortDescription: function(){
		let pVar = this._getPAProperty(this._outputSink, 'org.PulseAudio.Core1.Device', 'ActivePort');
		let portAddr = pVar.get_string()[0];

		let desc = this._getPAProperty(portAddr, 'org.PulseAudio.Core1.DevicePort', 'Description');
		return desc.get_string()[0];
	},

	_getPAProperty: function(path, iface, property){
		try{
			let response = this._paDBusConnection.call_sync(null, path, 'org.freedesktop.DBus.Properties', 'Get',
				GLib.Variant.new('(ss)', [iface, property]), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);
			return response.get_child_value(0).unpack();
		} catch(e){
			log('Laine: Exception getting value :: '+e);
			return null;
		}
	},

	_setPAProperty: function(path, iface, property, value){
		if(value instanceof GLib.Variant)
			try{
				this._paDBusConnection.call_sync(null, path, 'org.freedesktop.DBus.Properties', 'Set',
					GLib.Variant.new('(ssv)', [iface, property, value]), null, Gio.DBusCallFlags.NONE, -1, null);
			} catch(e){
				log('Laine: Exception getting value :: '+e);
			}
	},

	//Event handlers
	_onSliderChanged: function(slider, value, property){
		if(!(this._muteVal && value == 0)){

			let startV = this._volVariant;

			let maxVal = startV.get_child_value(0).get_uint32();
			for(let i = 1; i < startV.n_children(); i++){
				let val = startV.get_child_value(i).get_uint32();
				if(val > maxVal) maxVal = val;
			}

			let target = value * PA_MAX;
			if(target != maxVal){ //Otherwise no change
				let targetValues = new Array();
				for(let i = 0; i < startV.n_children(); i++){
					let newVal;
					if(maxVal == 0)
						newVal = target;
					else { //To maintain any balance the user has set.
						let oldVal = startV.get_child_value(i).get_uint32();
						newVal = (oldVal/maxVal)*target;
					}
					newVal = Math.round(newVal);
					targetValues[i] = GLib.Variant.new_uint32(newVal);
				}

				let prop = GLib.Variant.new_array(null, targetValues);
				//this._volVariant = prop;
				this._setPAProperty(this._outputSink, 'org.PulseAudio.Core1.Device', 'Volume', prop);
			}
		}
	},

	_onMuteClick: function(){
		this._setPAProperty(this._outputSink, 'org.PulseAudio.Core1.Device', 'Mute', GLib.Variant.new_boolean(!this._muteVal));
	},

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

	_onSinkChange: function(conn, sender, object, iface, signal, param, user_data){
		let addr = param.get_child_value(0).get_string()[0];

		if(signal == 'FallbackSinkUpdated'){
			this._outputSink = addr;
			this._paDBusConnection.signal_unsubscribe(this._volSig);
			this._paDBusConnection.signal_unsubscribe(this._muteSig);
			this._paDBusConnection.signal_unsubscribe(this._portSig);

			this._volSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'VolumeUpdated',
				this._outputSink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
			this._muteSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'MuteUpdated',
				this._outputSink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeChanged), null );
			this._portSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Device', 'ActivePortUpdated',
				this._outputSink, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onPortChanged), null );

			//Force update of mute and volume saved values
			let mute = this.getMute();
			let vol = this.getVolume();
			if(mute) vol = 0;
			this._slider.setValue(vol);
		} 
		else if(signal == 'NewSink'){
			let name = this._getPAProperty(addr, 'org.PulseAudio.Core1.Device', 'Name');
			if(name != null){
				name = name.get_string()[0];

				let item = new PopupMenu.PopupMenuItem(name);
				item._sinkPath = addr;
				this.menu.addMenuItem(item);
				this._sinks[addr] = item;
				this._sinks.length ++;
				if(this._sinks.length > 1)
					this._expandBtn.show();
			}
		}
		else if(signal == 'SinkRemoved'){
			if(addr in this._sinks){
				this._sinks[addr].destroy();
				delete this._sinks[addr];
				this._sinks.length --;
				if(this._sinks.length < 2)
					this._expandBtn.hide();

			}
		}
	},



	_onPortChanged: function(conn, sender, object, iface, signal, param, user_data){
		let desc = this._getPAProperty(param.get_child_value(0).get_string()[0], 'org.PulseAudio.Core1.DevicePort', 'Description');
		desc = desc.get_string()[0];
		if(desc == 'Headphones')
			this._icon.icon_name = 'audio-headphones-symbolic';
		else if(desc == 'Digital Output (S/PDIF)')
			this._icon.icon_name = 'audio-card-symbolic';
		else
			this._icon.icon_name = 'audio-speakers-symbolic';

	},

	_onDestroy: function(){
		this._paDBusConnection.signal_unsubscribe(this._volSig);
		this._paDBusConnection.signal_unsubscribe(this._muteSig);
		this._paDBusConnection.signal_unsubscribe(this._portSig);
		this._paDBusConnection.signal_unsubscribe(this._falSig);
		this._paDBusConnection.signal_unsubscribe(this._skaSig);
		this._paDBusConnection.signal_unsubscribe(this._skrSig);
	}

});