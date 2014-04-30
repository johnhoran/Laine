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

const PA_MAX = 65536;

const StreamMenu = new Lang.Class({
	Name: 'StreamMenu',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(paconn){
		this.parent();
		this._paDBus = paconn;

		//this._mprisControl = new MPRISStream.Control(this, this._paDBus);

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
		this._sigNewStr = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', 'NewPlaybackStream',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onAddStream), null );
		this._sigRemStr = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1', 'PlaybackStreamRemoved',
			'/org/pulseaudio/core1', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onRemoveStream), null );

		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},

	getCurrentStreams: function(){
		let response = this._paDBus.call_sync(null, '/org/pulseaudio/core1', 'org.freedesktop.DBus.Properties', 'Get',
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
			let response = this._paDBus.call_sync(null, path, 'org.freedesktop.DBus.Properties', 'Get',
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

		let stream = new SimpleStream(this._paDBus, path, streamProps);
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
		this._paDBus.signal_unsubscribe(this._sigNewStr);
		this._paDBus.signal_unsubscribe(this._sigRemStr);
	}
});


const StreamBase = new Lang.Class({
	Name: 'StreamBase',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(paconn){
		this.parent();
		this._paDBus = paconn;
		this._paPath = null;

		this._label = new St.Label({style_class: 'simple-stream-label', reactive: true})
		this._muteBtn = new St.Button();
		this._volSlider = new Slider.Slider(0);

		//------------------------------------------------------------------
		//Laying out components
		let container = new St.BoxLayout({vertical:true});
		container.add_actor(this._label);
		container.add_actor(this._volSlider.actor,{expand:true});

		this.actor.add_style_class_name('stream');
		this.actor.set_vertical(false);
		this.actor.set_track_hover(true);
		this.actor.set_reactive(true);

		this.actor.add(this._muteBtn);
		this.actor.add(container, {expand:true});

		//------------------------------------------------------------------
		
		this._muteBtn.connect('clicked', Lang.bind(this, function(){
			this.setVolume(!this._muteVal);
		}));

		this._volSlider.connect('value-changed', Lang.bind(this, function(slider, value, property){
			this.setVolume(value);
		}));

		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},

	setPAPath: function(path){
		this._paPath = path;

		this._paDBus.call(null, this._paPath, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', 'Mute']), GLib.VariantType.new("(v)"), 
			Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this, function(conn, query){
				let result = conn.call_finish(query);
				this.setVolume(result.get_child_value(0).unpack());
			}));

		this._paDBus.call(null, this._paPath, 'org.freedesktop.DBus.Properties', 'Get',
			GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', 'Volume']), GLib.VariantType.new("(v)"), 
			Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this, function(conn, query){
				let result = conn.call_finish(query);
				this.setVolume(result.get_child_value(0).unpack());
			}));

		this._sigVol = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Stream', 'VolumeUpdated',
			this._paPath, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, function(conn, sender, object, iface, signal, param, user_data){
				this.setVolume(param.get_child_value(0));
			}), null );
		this._sigMute = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Stream', 'MuteUpdated',
			this._paPath, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, function(conn, sender, object, iface, signal, param, user_data){
				this.setVolume(param.get_child_value(0));
			}), null );
	},

	setVolume: function(volume){
		if(typeof volume === 'boolean'){
			let val = GLib.Variant.new_boolean(volume);
			this._paDBus.call(null, this._paPath, 'org.freedesktop.DBus.Properties', 'Set',
				GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Stream', 'Mute', val]), null, 
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
				this._paDBus.call(null, this._paPath, 'org.freedesktop.DBus.Properties', 'Set',
					GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Stream', 'Volume', targets]), null, 
					Gio.DBusCallFlags.NONE, -1, null, null);
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

					this._volSlider.setValue(maxVal/PA_MAX);
				}
			}
			else if(type == 'b'){
				this._muteVal = volume.get_boolean();
				if(this._muteVal)
					this._volSlider.setValue(0);
				else if(this._volVariant)
					this.setVolume(this._volVariant);
			}
		}
	},

	_onDestroy: function(){
		if(this._paPath != null){
			this._paDBus.signal_unsubscribe(this._sigVol);
			this._paDBus.signal_unsubscribe(this._sigMute);
		}
	},

	_raise: function(){}

});

const SimpleStream = new Lang.Class({
	Name: 'SimpleStream',
	Extends: StreamBase,

	_init: function(paconn, path, sInfo){
		this.parent(paconn);
		this.setPAPath(path);

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

		this._muteBtn.child = icon;
		this._label.text = name;


		this._raise = function(){
			if(this._app != null)
				this._app.activate();
		};

		this._label.connect('button-press-event', Lang.bind(this, this._raise));
	},

});