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
const VOLUME_NOTIFY_ID = 1;

const StreamMenu = new Lang.Class({
	Name: 'StreamMenu',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(paconn){
		this.parent();
		this._paDBusConnection = paconn;
		this._streams = {};

		let streams = this.getCurrentStreams();
		for(let i = 0; i < streams.length; i++){
			let stream = new SimpleStream(this._paDBusConnection, streams[i]);
			if(stream.isNotable()){
				this._streams[streams[i]] = stream;
				this.addMenuItem(stream);
			}
		}

		//Add signal handlers
		this._newStrSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1', 'NewPlaybackStream',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._addStream), null );
		this._remStrSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1', 'PlaybackStreamRemoved',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._removeStream), null );

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

	_addStream: function(conn, sender, object, iface, signal, param, user_data){
		let streamPath = param.get_child_value(0).unpack();
		
		let stream = new SimpleStream(this._paDBusConnection, streamPath);
		if(stream.isNotable()){
			this._streams[streamPath] = stream;
			this.addMenuItem(stream);
		}

	},

	_removeStream: function(conn, sender, object, iface, signal, param, user_data){
		
		let streamPath = param.get_child_value(0).unpack();
		
		if(streamPath in this._streams){

			this._streams[streamPath].destroy();
			delete this._streams[streamPath];
		}
	},

	_onDestroy: function(){
		this._paDBusConnection.signal_unsubscribe(this._newStrSig);
		this._paDBusConnection.signal_unsubscribe(this._remStrSig);
	}
});


const SimpleStream = new Lang.Class({
	Name: 'SimpleStream',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(paconn, path){
		this.parent();
		this._paDBusConnection = paconn;
		this._path = path;

		let sInfo = this.getStreamInformation();
		this._procID = parseInt(sInfo['application.process.id']);
		if('media.role' in sInfo){
			this._role = sInfo['media.role'];
			this._role = this._role.substring(0, this._role.length -1); //Need to drop a newline from the end of this string;
		} else 
			this._role = '';


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
    	muteBtn.connect('clicked', Lang.bind(this, this.toggleMute));

		let label = new St.Label({text:name, style_class: 'simple-stream-label', reactive: true});
		
		let volume;
		if(this.isMuted())
			volume = 0;
		else 
			volume = this.getVolume();

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

		this._volSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Stream', 'VolumeUpdated',
			this._path, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._volumeEvent), null );
		this._muteSig = this._paDBusConnection.signal_subscribe(null, 'org.PulseAudio.Core1.Stream', 'MuteUpdated',
			this._path, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._volumeEvent), null );

		this._volSlider.connect('value-changed', Lang.bind(this, this._volSliderChanged));
		this._volSlider.connect('drag-end', Lang.bind(this, this._notifyVolumeChange));
		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},

	isNotable:function(){
		if(this._role == 'event')
			return false;
		return true;
	},

	_getPAProperty: function(property){
		try{
			let response = this._paDBusConnection.call_sync(null, this._path, 'org.freedesktop.DBus.Properties', 'Get',
				GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', property]), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);

			return response.get_child_value(0).unpack();
		} catch(e) {
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

	getStreamInformation: function(){
		let ans = {};

		let properties = this._getPAProperty('PropertyList');
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

	getVolume: function(){
		let volume = this._getPAProperty('Volume');
		this._volVariant = volume; //Save this so I can maintain balance when changing volumes;
		if(volume == null) return 0;

		let avg = 0;
		let num = volume.n_children();
		for(let i = 0; i < num; i++)
			avg += volume.get_child_value(i).get_uint32() / num;
		let max = 65536; //This value comes from pactl, it is possible for it to exceed this if it is set in the control panel though, but that is then represented as > 100%

		return avg/max;
	},

	isMuted: function(){
		let mute = this._getPAProperty('Mute');
		if(mute == null) return true;

		return mute.get_boolean();
	},

	switchToApp: function(){
		if(this._app != null)
			this._app.activate();
	},

	_volumeEvent: function(conn, sender, object, iface, signal, param, user_data){
		if(signal == 'MuteUpdated'){
			if(this.isMuted())
				this._volSlider.setValue(0);
			else
				this._volSlider.setValue(this.getVolume());
		} else if(signal == 'VolumeUpdated'){
			this._volSlider.setValue(this.getVolume());
		}
	},

	toggleMute: function(){
		let muteVal = (this._volSlider.value != 0);

		this._setPAProperty('Mute', GLib.Variant.new_boolean(muteVal));
	},

	_volSliderChanged: function(slider, value, property) {
		let max = 65536;
		let startV = this._volVariant;

		let maxVal = startV.get_child_value(0).get_uint32();
		for(let i = 1; i < startV.n_children(); i++){
			let cval = startV.get_child_value(i).get_uint32();
			if(cval > maxVal)
				maxVal = cval;
		}

		let target = value * max;
		if(target != maxVal){ //Otherwise no change
			let targetValues = new Array();
			for(let i = 0; i < startV.n_children(); i++){
				let newVal;
				if(maxVal == 0)
					newVal = target;
				else { //To maintain any weird balance the user has set.
					let oldVal = startV.get_child_value(i).get_uint32();
					newVal = (oldVal/maxVal)*target;
				}
				newVal = Math.round(newVal);
				targetValues[i] = GLib.Variant.new_uint32(newVal);
			}

			let prop = GLib.Variant.new_array(null, targetValues);
			this._setPAProperty('Volume', prop);
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
		this._paDBusConnection.signal_unsubscribe(this._volSig);
		this._paDBusConnection.signal_unsubscribe(this._muteSig);
	}

});