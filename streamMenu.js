const Gio = imports.gi.Gio;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;

const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;
const Main = imports.ui.main;
const Slider = imports.ui.slider;

const WindowTracker = Shell.WindowTracker.get_default();
const Me = imports.misc.extensionUtils.getCurrentExtension();

const MPRISStream = Me.imports.mprisStream;

const VOLUME_NOTIFY_ID = 1;
const PA_MAX = 65536;

const StreamMenu = new Lang.Class({
	Name: 'StreamMenu',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(paconn){
		this.parent();
		this._paDBusConnection = paconn;

		this._mprisControl = new MPRISStream.Control(this, this._paDBusConnection);

		this._streams = {};
		this._delegatedStreams = {};
		this._streams.length = 0;

		let streams = this.getCurrentStreams();
		for(let i = 0; i < streams.length; i++)
			this._addPAStream(streams[i]);
/*
		if(this._streams.length == 0)
				this.actor.hide();*/

		//Add signal handlers
		this._sigNewStr = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1', 'NewPlaybackStream',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onAddStream), null );
		this._sigRemStr = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1', 'PlaybackStreamRemoved',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onRemoveStream), null );

		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},

	getCurrentStreams: function(){
		let response = this._paDBusConnection.call_sync(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1', 'PlaybackStreams']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);

		let streams = response.get_child_value(0).unpack();

		let ans = new Array();
		for(let i = 0; i < streams.n_children(); i++){
			ans[i] = streams.get_child_value(i).get_string()[0];
		}

		return ans;
	},

	getPAStreamInformation: function(path){
		let properties;
		try{
			let response = this._paDBusConnection.call_sync(null, path, 'org.freedesktop.DBus.Properties', 'Get',
				GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', 'PropertyList']), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);

			properties = response.get_child_value(0).unpack();
		} catch(e){
			log("Laine: exception when conneting to PA DBus "+e);
			return null;
		}

		let ans = {};
		if(properties != null)
			for(let i = 0; i < properties.n_children(); i++){
				let [index, value] = properties.get_child_value(i).unpack();
				let bytes = new Array();
				for(let j = 0; j < value.n_children(); j++)
					bytes[j] = value.get_child_value(j).get_byte();

				ans[index.get_string()[0]] = String.fromCharCode.apply(String, bytes);
			}

		return ans;
	},

	_addPAStream: function(path){
		let streamProps = this.getPAStreamInformation(path);
		
		let pID = parseInt(streamProps['application.process.id']);
		if('media.role' in streamProps){
			let role = streamProps['media.role'];
			role = role.substring(0, role.length -1); 
			if(role == 'event') return;
		}

		if(this._mprisControl){
			let mprisCheck = this._mprisControl.isMPRISStream(pID, path);
			if(mprisCheck){
				this._delegatedStreams[path] = this._mprisControl;
				return;
			}
		}

		let stream = new SimpleStream(this._paDBusConnection, path, streamProps);
		this._streams[path] = stream;
		this.addMenuItem(stream);
		this._streams.length ++;
	},

	_onAddStream: function(conn, sender, object, iface, signal, param, user_data){
		let streamPath = param.get_child_value(0).unpack();
		this._addPAStream(streamPath);
/*
		if(this._streams.length > 0)
			this.actor.show();*/
	},

	_onRemoveStream: function(conn, sender, object, iface, signal, param, user_data){
		
		let streamPath = param.get_child_value(0).unpack();
		
		if(streamPath in this._streams){

			this._streams[streamPath].destroy();
			delete this._streams[streamPath];
			this._streams.length --;
/*
			if(this._streams.length == 0)
				this.actor.hide();*/
		}
		else if(streamPath in this._delegatedStreams){
			this._delegatedStreams[streamPath].removePAStream(streamPath);
			delete this._delegatedStreams[streamPath];
		}
	},

	_onDestroy: function(){
		this._paDBusConnection.signal_unsubscribe(this._sigNewStr);
		this._paDBusConnection.signal_unsubscribe(this._sigRemStr);
	}
});


const SimpleStream = new Lang.Class({
	Name: 'SimpleStream',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(paconn, path, sInfo){
		this.parent();
		this._paDBusConnection = paconn;
		this._path = path;

		this._procID = parseInt(sInfo['application.process.id']);

		this._app = WindowTracker.get_app_from_pid(this._procID);
		if(this._app == null){
			//Doesn't have an open window, lets check the tray.
			let trayNotifications = Main.messageTray.getSources();
			for(let i = 0; i < trayNotifications.length; i++)
				if(trayNotifications[i].pid == this._procID)
					this._app = trayNotifications[i].app;
		}

		let icon, name;
		if(this._app == null){
			name = sInfo['application.name'];
			let iname;
			if('application.icon_name' in sInfo) iname = sInfo['application.icon_name'];
			else iname = 'package_multimedia';
			icon = new St.Icon({icon_name: iname, style_class: 'simple-stream-icon'});
		} else {
			let info = this._app.get_app_info();
			name = info.get_name();
			icon = new St.Icon({style_class: 'simple-stream-icon'});
			icon.set_gicon(info.get_icon());
		}

    	let muteBtn = new St.Button({child: icon});
		let label = new St.Label({text:name, style_class: 'simple-stream-label', reactive: true});
		
		let volume = this.getVolume();
		let mute = this.isMuted();
		if(mute) volume = 0;

		this._volSlider = new Slider.Slider(volume);
		this._volSlider.actor.add_style_class_name('simple-stream-slider');

		//------------------------------------------------------------------
		//Laying out components
		let container = new St.BoxLayout({vertical:true});
		container.add_actor(label);
		container.add_actor(this._volSlider.actor,{expand:true});

		this.actor.add_style_class_name('stream');
		this.actor.set_vertical(false);
		this.actor.set_track_hover(true);
		this.actor.set_reactive(true);

		this.actor.add(muteBtn);
		this.actor.add(container, {expand:true});

		//------------------------------------------------------------------
		//Adding any listeners

		label.connect('button-press-event', Lang.bind(this, this.switchToApp));
    	muteBtn.connect('clicked', Lang.bind(this, this._onMuteClick));

		this._sigVol = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Stream', 'VolumeUpdated',
			this._path, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeEvent), null );
		this._sigMute = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Stream', 'MuteUpdated',
			this._path, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeEvent), null );

		this._volSlider.connect('value-changed', Lang.bind(this, this._onVolSliderChanged));
		this._volSlider.connect('drag-end', Lang.bind(this, this._notifyVolumeChange));
		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},

	_getPAProperty: function(property){
		try{
			let response = this._paDBusConnection.call_sync(null, this._path, 'org.freedesktop.DBus.Properties', 'Get',
				GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', property]), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);

			return response.get_child_value(0).unpack();
		} catch(e) {
			log('Laine: Exception getting value for ' +this._path +" :: "+e);
			return null;
		}
	},

	_setPAProperty: function(property, value){
		if(value instanceof GLib.Variant)
			try{
				this._paDBusConnection.call_sync(null, this._path, 'org.freedesktop.DBus.Properties', 'Set',
					GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Stream', property, value]), null, Gio.DBusCallFlags.NONE, -1, null);
			} catch(e){
				log('Laine: Exception setting value for ' +this._path +" :: "+e);
			}
	},

	getVolume: function(){
		let volume = this._getPAProperty('Volume');
		this._volVariant = volume; //Save this so I can maintain balance when changing volumes;
		if(volume == null) return 0;

		let maxVal = volume.get_child_value(0).get_uint32();
		for(let i = 1; i < volume.n_children(); i++){
			let val = volume.get_child_value(i).get_uint32();
			if(val > maxVal) maxVal = val;
		}

		return maxVal/PA_MAX;
	},

	isMuted: function(){
		let mute = this._getPAProperty('Mute');
		let ans;
		if(mute == null) ans = true;
		else ans = mute.get_boolean();
		this._muteVal = ans;
		return ans;
	},

	switchToApp: function(){
		if(this._app != null)
			this._app.activate();
	},

	_onVolumeEvent: function(conn, sender, object, iface, signal, param, user_data){
		if(signal == 'MuteUpdated'){
			this._muteVal = param.get_child_value(0).get_boolean();

			if(this._muteVal)
				this._volSlider.setValue(0);
			else {
				let max = this._volVariant.get_child_value(0).get_uint32();
				for(let i = 1; i < this._volVariant.n_children(); i++){
					let val = this._volVariant.get_child_value(i).get_uint32();
					if(max < val) max = val;
				}
				this._volSlider.setValue(max/PA_MAX);
			}
		}
		else if(signal == 'VolumeUpdated'){
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
				this._volSlider.setValue(newMax / PA_MAX);
			}
		} 
	},

	_onMuteClick: function(){
		this._setPAProperty('Mute', GLib.Variant.new_boolean(!this._muteVal));
	},

	_onVolSliderChanged: function(slider, value, property){
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

				this._setPAProperty('Volume', prop);
				if(this._muteVal)
					this._setPAProperty('Mute', GLib.Variant.new_boolean(false));
			}
		}
	},

	_notifyVolumeChange: function() {
		global.cancel_theme_sound(VOLUME_NOTIFY_ID);
		global.play_theme_sound(VOLUME_NOTIFY_ID,
			'audio-volume-change',
			_("Volume changed"),
			Clutter.get_current_event ());
	},

	_onDestroy: function(){
		this._paDBusConnection.signal_unsubscribe(this._sigVol);
		this._paDBusConnection.signal_unsubscribe(this._sigMute);
	}

});