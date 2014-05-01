const Gio = imports.gi.Gio;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;

const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;
const Main = imports.ui.main;
const Slider = imports.ui.slider;
const Loop = imports.mainloop;

const WindowTracker = Shell.WindowTracker.get_default();
const Me = imports.misc.extensionUtils.getCurrentExtension();

const StreamMenu = Me.imports.streamMenu;

const PA_MAX = 65536;
const WATCH_RULE = "type='signal'," +
		"sender='org.freedesktop.DBus'," +
		"interface='org.freedesktop.DBus'," +
		"member='NameOwnerChanged'," +
		"path='/org/freedesktop/DBus'," +
		"arg0namespace='org.mpris.MediaPlayer2'";


const Control = new Lang.Class({
	Name: 'MPRISControl',

	_init: function(parent, paconn){
		this._parent = parent;
		this._paDBus = paconn
		this.actor = parent.actor;

		this._mprisStreams = {};
		this._mprisStreams.length = 0;

		this._dbus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
	//	this._dbus = Gio.DBusConnection.new_for_address_sync('unix:path=/tmp/socat-listen', Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null);
	//	this._dbus.call_sync('org.freedesktop.DBus', '/', "org.freedesktop.DBus", "Hello", null, GLib.VariantType.new("(s)"), Gio.DBusCallFlags.NONE, -1, null);

		this._addMPRISStreams(this._dbus);

		this._dbus.call_sync('org.freedesktop.DBus', '/', "org.freedesktop.DBus", "AddMatch",
			GLib.Variant.new('(s)', [WATCH_RULE]), null, Gio.DBusCallFlags.NONE, -1, null);
		this._sigNOC = this._dbus.signal_subscribe('org.freedesktop.DBus', "org.freedesktop.DBus", "NameOwnerChanged",
    		"/org/freedesktop/DBus", null, Gio.DBusSignalFlags.NO_MATCH_RULE, Lang.bind(this, this._onConnChange));

		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},

	_addMPRISStreams: function(dbus){
		let connections = this._dbus.call_sync('org.freedesktop.DBus', '/', "org.freedesktop.DBus", "ListNames",
			null, GLib.VariantType.new("(as)"), Gio.DBusCallFlags.NONE, -1, null);
		connections = connections.get_child_value(0).unpack();

		for(let i = 0; i < connections.length; i++){
			let path = connections[i].get_string()[0];
			if(path.search('^org.mpris.MediaPlayer2') == -1)
				continue;

			let pid = this._dbus.call_sync('org.freedesktop.DBus', '/', "org.freedesktop.DBus", "GetConnectionUnixProcessID",
				GLib.Variant.new('(s)', [path]), GLib.VariantType.new("(u)"), Gio.DBusCallFlags.NONE, -1, null);
			pid = pid.get_child_value(0).get_uint32();

			if(!(pid in this._mprisStreams)) {
				let uName = this._dbus.call_sync('org.freedesktop.DBus', '/', "org.freedesktop.DBus", "GetNameOwner",
					GLib.Variant.new('(s)', [path]), GLib.VariantType.new('(s)'), Gio.DBusCallFlags.NONE, -1, null);
				uName = uName.get_child_value(0).unpack();

				let newStr = new MPRISStream2(uName, pid, this._dbus, this._paDBus);
				this._mprisStreams[pid] = newStr;
				this.actor.add(newStr.actor);
				this._mprisStreams.length ++;
			}
		}
	},

	removePAStream:function(path){
		for(let pid in this._mprisStreams){
			if(this._mprisStreams[pid]._paPath == path){
				this._mprisStreams[pid].unsetPAStream();
				break;
			}
		}
	},

	isMPRISStream: function(pid, path){
		if(pid in this._mprisStreams){
			this._mprisStreams[pid].setPAStream(path);
			return true;
		}
		return false;
	},

	_onConnChange: function(conn, sender, object, iface, signal, param, user_data){
		let path = param.get_child_value(0).get_string()[0];
		let add = (param.get_child_value(1).get_string()[0] == '');

		if(path.search('^org.mpris.MediaPlayer2') != 0)
			return;

		if(add){
			let uName = param.get_child_value(2).get_string()[0];

			let pid = this._dbus.call_sync('org.freedesktop.DBus', '/', "org.freedesktop.DBus", "GetConnectionUnixProcessID",
				GLib.Variant.new('(s)', [uName]), GLib.VariantType.new("(u)"), Gio.DBusCallFlags.NONE, -1, null);
			pid = pid.get_child_value(0).get_uint32();

			if(!(pid in this._mprisStreams)){
				let newStr = new MPRISStream2(uName, pid, this._dbus, this._paDBus);
				this._mprisStreams[pid] = newStr;
				this.actor.add(newStr.actor);
				this._mprisStreams.length ++;
			}
		}
		else {
			for(let k in this._mprisStreams){
				let uName = param.get_child_value(1).get_string()[0];
				if(k != 'length' && this._mprisStreams[k]._path == uName){
					this._mprisStreams[k].destroy();
					delete this._mprisStreams[k];
					break;
				}
			}
		}
	},

	_onDestroy: function(){
		this._dbus.signal_unsubscribe(this._sigNOC);
		this._dbus.call_sync('org.freedesktop.DBus', '/', "org.freedesktop.DBus", "RemoveMatch",
			GLib.Variant.new('(s)', [rule]), null, Gio.DBusCallFlags.NONE, -1, null);
	}

});

const MPRISStream = new Lang.Class({
	Name: 'MPRISStream',
	Extends: PopupMenu.PopupMenuSection,

	_init: function(dbusPath, pid, dbus, paconn){
		this.parent();
		this._path = dbusPath;
		this._procID = pid;
		this._dbus = dbus;
		this._paDBus = paconn;
		this._paPath = null;


		this._dbus.call(this._path, '/org/mpris/MediaPlayer2', "org.freedesktop.DBus.Properties", "Get",
			GLib.Variant.new('(ss)', ['org.mpris.MediaPlayer2', 'DesktopEntry']), GLib.VariantType.new("(v)"),
			Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this, this._hdlDesktopEntry));

/*
		let dEntry = this._getDBusProperty('org.mpris.MediaPlayer2', 'DesktopEntry').get_string()[0];
		let icon, name;
		if(dEntry != ''){
			let app = Shell.AppSystem.get_default().lookup_app(dEntry+".desktop");
			if(app != null){
				let info = app.get_app_info();
				name = info.get_name();
				icon = new St.Icon({style_class: 'simple-stream-icon'});
				icon.set_gicon(info.get_icon());
			}
		} 

		if(name == null){
			name = this._getDBusProperty('org.mpris.MediaPlayer2', 'Identity').get_string()[0];
			icon = new St.Icon({icon_name: 'package_multimedia', style_class: 'simple-stream-icon'});
		}*/

		this._muteBtn = new St.Button();
		this._label = new St.Label({style_class: 'simple-stream-label', reactive: true});
		this._volSlider = new Slider.Slider(0);

		this._songLbl = new St.Label({style_class:'mpris-meta-title'});
		this._artistLbl = new St.Label({style_class:'mpris-meta-info'});
		this._albumLbl = new St.Label({style_class:'mpris-meta-info'});
		this._albumArt = new St.Icon({style_class:'mpris-album-art'});

		this._playBtn = new St.Button({child: new St.Icon({icon_name: 'media-playback-start-symbolic'}), style_class:'mpris-play-button'});
		this._prevBtn = new St.Button({child: new St.Icon({icon_name: 'media-skip-backward-symbolic'}), style_class:'mpris-previous-button'});
		this._nextBtn = new St.Button({child: new St.Icon({icon_name: 'media-skip-forward-symbolic'}), style_class:'mpris-next-button'});

		this._mediaLength = 0;
		this._posSlider = new Slider.Slider(0);
		this._timeLapLbl = new St.Label({style_class:'mpris-time-label', text:'0.00'});
		this._timeRemLbl = new St.Label({style_class:'mpris-time-label', text:'-0.00'});


		//Laying out the components
		let volBoxI = new St.BoxLayout({vertical:true});
		volBoxI.add(this._label);
		volBoxI.add(this._volSlider.actor,{expand:true});
		let volBoxO = new St.BoxLayout();
		volBoxO.add(this._muteBtn);
		volBoxO.add(volBoxI, {expand:true});

		let artistBox = new St.BoxLayout();
		artistBox.add(new St.Label({text:'by', style_class:'mpris-label-subtext'}));
		artistBox.add(this._artistLbl);
		let albumBox = new St.BoxLayout();
		albumBox.add(new St.Label({text:'from', style_class:'mpris-label-subtext'}));
		albumBox.add(this._albumLbl);
		this._detailBox = new St.BoxLayout({vertical:true});
		this._detailBox.add(this._songLbl);
		this._detailBox.add(artistBox);
		this._detailBox.add(albumBox);
		this._sigUpdPos = 0;

		let mediaControls = new St.BoxLayout({style_class: 'mpris-player-controls'});
		mediaControls.add(this._prevBtn);
		mediaControls.add(this._playBtn);
		mediaControls.add(this._nextBtn);

		let innerBox = new St.BoxLayout({vertical:true});
		innerBox.add(this._detailBox);
		innerBox.add(mediaControls);

		this._metaDisplay = new St.BoxLayout({style_class:'mpris-metadata-display'});
		this._metaDisplay.add(this._albumArt);
		this._metaDisplay.add(innerBox);

		this._timeBox = new St.BoxLayout({style_class:'mpris-time-container'});
		this._timeBox.add(this._timeLapLbl);
		this._timeBox.add(this._posSlider.actor, {expand:true});
		this._timeBox.add(this._timeRemLbl);


		this.actor.add(volBoxO, {expand:true});
		this.actor.add(this._metaDisplay);
		//this.actor.add(mediaControls);
		//this.actor.add(this._playorderControls);
		//this.actor.add(this._fullscreenBtn);
		this.actor.add(this._timeBox, {expand:true});
		this.actor.add_style_class_name('mpris-stream');

		this._updateMetadata(this._getDBusProperty('org.mpris.MediaPlayer2.Player', 'Metadata'));

		//Add Listeners
		this._sigPropChange = dbus.signal_subscribe(this._path, 'org.freedesktop.DBus.Properties',
			'PropertiesChanged', '/org/mpris/MediaPlayer2', null, Gio.DBusSignalFlags.NONE, 
			Lang.bind(this, this._onPropChange), null);
		this._sigSeeked = dbus.signal_subscribe(this._path, 'org.mpris.MediaPlayer2.Player',
			'Seeked', '/org/mpris/MediaPlayer2', null, Gio.DBusSignalFlags.NONE, 
			Lang.bind(this, this._onPropChange), null);
		this._volSlider.connect('value-changed', Lang.bind(this, this._onVolSliderChange));
		this._posSlider.connect('value-changed', Lang.bind(this, this._onPosSliderChange));
		this._playBtn.connect('clicked', Lang.bind(this, this._onControlBtnClick));
		this._nextBtn.connect('clicked', Lang.bind(this, this._onControlBtnClick));
		this._prevBtn.connect('clicked', Lang.bind(this, this._onControlBtnClick));

		this._muteBtn.connect('clicked', Lang.bind(this, this._onMuteClick));


		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},


	//Async functions
	_hdlDesktopEntry: function(conn, result){
		let res = conn.call_finish(result);
		res = res.get_child_value(0).unpack();
		
		let dName = res.get_string()[0];
		let icon;
		let app = Shell.AppSystem.get_default().lookup_app(dName+".desktop");
		if(app != null){
			let info = app.get_app_info();
			this._label.text = info.get_name();
			icon = new St.Icon({style_class: 'simple-stream-icon'});
			icon.set_gicon(info.get_icon());
		} else {
			icon = new St.Icon({icon_name: 'package_multimedia', style_class: 'simple-stream-icon'});
			this._dbus.call(this._path, '/org/mpris/MediaPlayer2', "org.freedesktop.DBus.Properties", "Get",
				GLib.Variant.new('(ss)', ['org.mpris.MediaPlayer2', 'Identity']), GLib.VariantType.new("(v)"),
				Gio.DBusCallFlags.NONE, -1, null, Lang.bind(this, this._hdlDesktopEntry));
		}

		this._muteBtn.child = icon;
	},

	_hdlIdentity: function(conn, result){
		let res = conn.call_finish(result);
		res = res.get_child_value(0).unpack();

		let identity = result.get_string()[0];
		this.label.text = identity;
	},


	/*
	* 0 - play button is the only control shown.
	*/
	setDisplayState: function(state){
		if(state == 0){
			this._prevBtn.hide();
			this._nextBtn.hide();
			this._timeBox.hide();
			this._detailBox.hide();
			this._albumArt.hide();

			this.actor.set_vertical(false);
			this._metaDisplay.add_style_pseudo_class('alone');
			this._playBtn.add_style_pseudo_class('alone');
		}
		else if(state == 1){
			this.actor.set_vertical(true);
			this._metaDisplay.remove_style_pseudo_class('alone');
			this._playBtn.remove_style_pseudo_class('alone');

			this._prevBtn.show();
			this._nextBtn.show();
			this._timeBox.show();
			this._detailBox.show();
			this._albumArt.show();
		}

	},

	setPAStream: function(path){
		this._paPath = path;

		this._volVariant = this._getPAProperty('Volume');; //Save this so I can maintain balance when changing volumes;
		if(this._volVariant == null){
			this._volSlider.setValue(0);
			this._muteVal = true;
		}
		else {
			this._muteVal = this._getPAProperty('Mute').get_boolean();
			if(this._muteVal)
				this._volSlider.setValue(0);
			else {

				let maxVal = this._volVariant.get_child_value(0).get_uint32();
				for(let i = 1; i < this._volVariant.n_children(); i++){
					let val = this._volVariant.get_child_value(i).get_uint32();
					if(val > maxVal) maxVal = val;
				}
				this._volSlider.setValue(maxVal/PA_MAX);
			}
		}

		this._sigVol = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Stream', 'VolumeUpdated',
			this._paPath, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeEvent), null );
		this._sigMute = this._paDBus.signal_subscribe(null, 'org.PulseAudio.Core1.Stream', 'MuteUpdated',
			this._paPath, null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onVolumeEvent), null );
	},

	unsetPAStream: function(){
		if(this._paPath){
			this._paDBus.signal_unsubscribe(this._sigVol);
			this._paDBus.signal_unsubscribe(this._sigMute);
		}

		this._paPath = null;
	},

	_updateMetadata: function(meta){
		if(meta.n_children() == 0)
			this.setDisplayState(0);
		else {

			let metaD = {};
			for(let i = 0; i < meta.n_children(); i++){
				let [key, val] = meta.get_child_value(i).unpack();

				key = key.get_string()[0];
				val = val.unpack();
				metaD[key] = val;
			}

			if('xesam:title' in metaD){
				this._songLbl.text = metaD['xesam:title'].get_string()[0];
			}

			if('xesam:artist' in metaD){
				let artists = metaD['xesam:artist'];
				let str = artists.get_child_value(0).get_string()[0];

				for(let i = 1; i < artists.n_children(); i++)
					str += ', '+artists.get_child_value(i).get_string()[0];

				this._artistLbl.text = str;
			}

			if('xesam:album' in metaD){
				this._albumLbl.text = metaD['xesam:album'].get_string()[0];
			}

			if('mpris:artUrl' in metaD){
				let filePath = metaD['mpris:artUrl'].get_string()[0];
				let iconPath = filePath.substring(7, filePath.length);

				if(GLib.file_test(iconPath, GLib.FileTest.EXISTS)){
					let file = Gio.File.new_for_path(iconPath)
					let icon = new Gio.FileIcon({file:file});
					this._albumArt.gicon = icon;
				}
			}

			if('mpris:trackid' in metaD)
				this._mediaID = metaD['mpris:trackid'].get_string()[0];

			if('mpris:length' in metaD)
				this._mediaLength = metaD['mpris:length'].get_int64();
			else 
				this._mediaLength = 0;

			this.setDisplayState(1);
		}
	},


	_onPropChange: function(conn, sender, object, iface, signal, param, user_data){
		if(signal == 'PropertiesChanged'){
			let sIface = param.get_child_value(0).get_string()[0];

			if(sIface == 'org.mpris.MediaPlayer2.Player'){
				let sigs = param.get_child_value(1);
				for(let i = 0; i < sigs.n_children(); i++){
					let [key, val] = sigs.get_child_value(i).unpack();
					key = key.get_string()[0];
					val = val.unpack();

					if(key == 'Metadata')
						this._updateMetadata(val);
					else if(key == 'PlaybackStatus'){
						let state = val.get_string()[0];
						if(state == 'Playing'){
							this._playBtn.child.icon_name = 'media-playback-pause-symbolic';

							this._mediaPosition = this._getDBusProperty('org.mpris.MediaPlayer2.Player', 'Position').get_int64();
							this._mediaRate = this._getDBusProperty('org.mpris.MediaPlayer2.Player', 'Rate').get_double();
							if(this._sigUpdPos == 0)
								this._sigUpdPos = Loop.timeout_add_seconds(1, Lang.bind(this, this._updatePosition));
						}
						else {
							if (this._sigUpdPos != 0) {
								Loop.source_remove(this._sigUpdPos);
								this._sigUpdPos = 0;
							}
							this._playBtn.child.icon_name = 'media-playback-start-symbolic';        
						}
					}
					else if(key == 'Volume'){
						let vol = val.get_double();
						if(!this._muteVal) this._appVol = vol;
						if(this._paPath == null)
							this._volSlider.setValue(vol);
					}
					else if(key == 'CanGoNext'){
						let b = val.get_boolean();
						print('CGN:'+b);
						this._nextBtn.can_focus = b;
						this._nextBtn.reactive = b;
						if(b)
							this._nextBtn.remove_style_pseudo_class('disabled');
						else 
							this._nextBtn.add_style_pseudo_class('disabled');
					}
					else 
						log('Unhandled '+key);
				}


			}
		} else if(signal == 'Seeked'){
			//Have to manually get the time as banshee doesn't send it.
			this._mediaPosition = this._getDBusProperty('org.mpris.MediaPlayer2.Player', 'Position').get_int64();
			
		}

	},

	_onControlBtnClick: function(button){
		if(button == this._playBtn){
			this._dbus.call(this._path, '/org/mpris/MediaPlayer2', "org.mpris.MediaPlayer2.Player", "PlayPause",
				null, null, Gio.DBusCallFlags.NONE, -1, null, null);
		}
		else if(button == this._prevBtn){
			this._dbus.call(this._path, '/org/mpris/MediaPlayer2', "org.mpris.MediaPlayer2.Player", "Previous",
				null, null, Gio.DBusCallFlags.NONE, -1, null, null);
		}
		else if(button == this._nextBtn){
			this._dbus.call(this._path, '/org/mpris/MediaPlayer2', "org.mpris.MediaPlayer2.Player", "Next",
				null, null, Gio.DBusCallFlags.NONE, -1, null, null);
		}

	},

	_onMuteClick: function(){
		let mute = !this._muteVal;

		if(this._paPath != null)
			this._setPAProperty('Mute', GLib.Variant.new_boolean(mute));
		else
			this._setDBusProperty('org.mpris.MediaPlayer2.Player', 'Volume', GLib.Variant.new_double(mute?0:this._appVol));
		this._muteVal = mute;
	},

	_onVolSliderChange: function(slider, value, property){
		if(this._paPath != null){ //Run it through pulse audio.	
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
		} else {
			this._setDBusProperty('org.mpris.MediaPlayer2.Player', 'Volume', GLib.Variant.new_double(value));
		}

	},

	_onPosSliderChange: function(slider, value, property){
		if(this._mediaLength != 0){
			let position = Math.floor(value * this._mediaLength);
			this._dbus.call(this._path, '/org/mpris/MediaPlayer2', "org.mpris.MediaPlayer2.Player", "SetPosition",
					GLib.Variant.new('(ox)', [this._mediaID, position]), null,
					Gio.DBusCallFlags.NONE, -1, null, null );
		}
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

	_updatePosition: function(){
		if(this._mediaLength > 0 && this._mediaLength >= this._mediaPosition){
			this._sigUpdPos = Loop.timeout_add_seconds(1, Lang.bind(this, this._updatePosition));

			this._mediaPosition += 1000000*this._mediaRate;
			this._timeLapLbl.text = this._formatSeconds(Math.floor(this._mediaPosition/1000000));
			this._timeRemLbl.text = '-'+this._formatSeconds(Math.floor((this._mediaLength - this._mediaPosition)/1000000));
			this._posSlider.setValue(this._mediaPosition/this._mediaLength);
		}
	},

	_formatSeconds: function(seconds){
		let mod = seconds % 60
		let ans = mod.toString();
		if(mod < 10) ans = '0'+ans;
		seconds = Math.floor(seconds/60);
		if(seconds > 0){
			ans = (seconds % 60) + ':' + ans;
			seconds = Math.floor(seconds/60);
		} 
		else 
			ans = '0:'+ans;
		if(seconds > 0)
			ans = seconds +':'+ans;
		return ans;
	},

	_getDBusProperty: function(iface, property){
		try{
			let resp = this._dbus.call_sync(this._path, '/org/mpris/MediaPlayer2', "org.freedesktop.DBus.Properties", "Get",
				GLib.Variant.new('(ss)', [iface, property]), GLib.VariantType.new("(v)"),
				Gio.DBusCallFlags.NONE, -1, null);
			return resp.get_child_value(0).unpack();
		} catch(e) {
			log('Laine: Exception getting value for ' +this._paPath +" :: "+e);
			return null;
		}
	},

	_setDBusProperty: function(iface, property, value){
		if(value instanceof GLib.Variant)
			try{
				this._dbus.call_sync(this._path, '/org/mpris/MediaPlayer2', "org.freedesktop.DBus.Properties", "Set",
					GLib.Variant.new('(ssv)', [iface, property, value]), null,
					Gio.DBusCallFlags.NONE, -1, null);
				} catch(e){
				log('Laine: Exception setting value for ' +this._paPath +" :: "+e);
			}

	},


	_getPAProperty: function(property){
		try{
			let response = this._paDBus.call_sync(null, this._paPath, 'org.freedesktop.DBus.Properties', 'Get',
				GLib.Variant.new('(ss)', ['org.PulseAudio.Core1.Stream', property]), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null);

			return response.get_child_value(0).unpack();
		} catch(e) {
			log('Laine: Exception getting value for ' +this._paPath +" :: "+e);
			return null;
		}
	},

	_setPAProperty: function(property, value){
		if(value instanceof GLib.Variant)
			try{
				this._paDBus.call(null, this._paPath, 'org.freedesktop.DBus.Properties', 'Set',
					GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Stream', property, value]), null, Gio.DBusCallFlags.NONE, -1, null, null);
			} catch(e){
				log('Laine: Exception setting value for ' +this._paPath +" :: "+e);
			}
	},

	_onDestroy: function(){
		if(this._paPath){
			this._paDBus.signal_unsubscribe(this._sigVol);
			this._paDBus.signal_unsubscribe(this._sigMute);
		}
	}
});






