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
				let newStr = new MPRISStream(path, pid, this._dbus, this._paDBus);
				this._mprisStreams[pid] = newStr;
				this.actor.add(newStr.actor);
				this._mprisStreams.length ++;
			}
		}
	},

	isMPRISStream: function(pid, path){
		if(pid in this._mprisStreams){
			this._mprisStreams[pid].setPAStream(path);
			return false;
			//return true;
		}
		return false;
	},

	_onConnChange: function(conn, sender, object, iface, signal, param, user_data){
		let path = param.get_child_value(0).get_string()[0];
		let add = (param.get_child_value(1).get_string()[0] == '');

		if(path.search('^org.mpris.MediaPlayer2') != 0)
			return;

		if(add){
			let pid = this._dbus.call_sync('org.freedesktop.DBus', '/', "org.freedesktop.DBus", "GetConnectionUnixProcessID",
				GLib.Variant.new('(s)', [path]), GLib.VariantType.new("(u)"), Gio.DBusCallFlags.NONE, -1, null);
			pid = pid.get_child_value(0).get_uint32();

			if(!(pid in this._mprisStreams)){
				let newStr = new MPRISStream(path, pid, this._dbus, this._paDBus);
				this._mprisStreams[pid] = newStr;
				this.actor.add(newStr.actor);
				this._mprisStreams.length ++;
			}
		}
		else {
			for(let k in this._mprisStreams){
				if(k != 'length' && this._mprisStreams[k]._path == path){
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
		}

		let muteBtn = new St.Button({child: icon});
		let label = new St.Label({text:name, style_class: 'simple-stream-label', reactive: true});
		this._volSlider = new Slider.Slider(0);

		this._songLbl = new St.Label({style_class:'mpris-meta-title'});
		this._artistLbl = new St.Label({style_class:'mpris-meta-info'});
		this._albumLbl = new St.Label({style_class:'mpris-meta-info'});
		this._albumArt = new St.Icon({style_class:'mpris-album-art'});

		this._playBtn = new St.Button({child: new St.Icon({icon_name: 'media-playback-start-symbolic'}), style_class:'mpris-play-button'});
		this._prevBtn = new St.Button({child: new St.Icon({icon_name: 'media-skip-backward-symbolic'}), style_class:'mpris-previous-button'});
		this._nextBtn = new St.Button({child: new St.Icon({icon_name: 'media-skip-forward-symbolic'}), style_class:'mpris-next-button'});

		this._fullscreenBtn = new St.Button({child: new St.Icon({icon_name: 'view-fullscreen-symbolic'}), style_class:'mpris-fullscreen-button'});
		this._shuffleBtn =  new St.Button({child: new St.Icon({icon_name: 'media-playlist-shuffle-symbolic'}), style_class:'mpris-shuffle-button'});
		this._repeatBtn = new St.Button({child: new St.Icon({icon_name: 'media-playlist-consecutive-symbolic'}), style_class:'mpris-repeat-button'});

		this._posSlider = new Slider.Slider(0);
		this._timeLapLbl = new St.Label({style_class:'mpris-time-label', text:'0.00'});
		this._timeRemLbl = new St.Label({style_class:'mpris-time-label', text:'-0.00'});


		//Laying out the components
		let volBoxI = new St.BoxLayout({vertical:true});
		volBoxI.add(label);
		volBoxI.add(this._volSlider.actor,{expand:true});
		let volBoxO = new St.BoxLayout();
		volBoxO.add(muteBtn);
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

/*
		this._playorderControls = new St.BoxLayout({style_class: 'mpris-play-order-controls', vertical:true});
		this._playorderControls.add(this._shuffleBtn);
		this._playorderControls.add(this._repeatBtn);*/

		let mediaControls = new St.BoxLayout({style_class: 'mpris-player-controls'});
		mediaControls.add(this._prevBtn);
		mediaControls.add(this._playBtn);
		mediaControls.add(this._nextBtn);
		mediaControls.add(this._shuffleBtn);
		mediaControls.add(this._repeatBtn);
		mediaControls.add(this._fullscreenBtn);

		let innerBox = new St.BoxLayout({vertical:true});
		innerBox.add(this._detailBox);
		innerBox.add(mediaControls);

		let metaDisplay = new St.BoxLayout({style_class:'mpris-metadata-display'});
		metaDisplay.add(this._albumArt);
		metaDisplay.add(innerBox);

		

		

		this._timeBox = new St.BoxLayout({style_class:'mpris-time-container'});
		this._timeBox.add(this._timeLapLbl);
		this._timeBox.add(this._posSlider.actor, {expand:true});
		this._timeBox.add(this._timeRemLbl);


		this.actor.add(volBoxO, {expand:true});
		this.actor.add(metaDisplay);
		//this.actor.add(mediaControls);
		//this.actor.add(this._playorderControls);
		//this.actor.add(this._fullscreenBtn);
		this.actor.add(this._timeBox, {expand:true});


		this.setDisplayState(0);
		log("CUR::"+this._path);
		//Add Listeners
		this._sigPropChange = dbus.signal_subscribe(this._path, 'org.freedesktop.DBus.Properties',
			'PropertiesChanged', '/org/mpris/MediaPlayer2', null, Gio.DBusSignalFlags.NONE, Lang.bind(this, this._onPropChange), GLib.Variant.new('(s)', [this._path]) );
	},


	/*
	* 0 - play button is the only control shown.
	*/
	setDisplayState: function(state){
		if(state == 0){
			this._prevBtn.hide();
			this._nextBtn.hide();
			this._timeBox.hide();
			this._shuffleBtn.hide();
			this._repeatBtn.hide();
			this._fullscreenBtn.hide();
			this._detailBox.hide();
			this._albumArt.hide();


			this.actor.set_vertical(false);
			this._playBtn.add_style_pseudo_class('alone');
		}
		else if(state == 1){
			this.actor.set_vertical(true);
			this._playBtn.remove_style_pseudo_class('alone');

			this._prevBtn.show();
			this._nextBtn.show();
			this._timeBox.show();
			this._shuffleBtn.show();
			this._repeatBtn.show();
			this._fullscreenBtn.hide();
			this._detailBox.show();
			this._albumArt.show();
		}

	},

	setPAStream: function(path){
		this._paPath = path;
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

			this.setDisplayState(1);
		}
		/*
'mpris:length'
'mpris:artUrl'*/
	},


	_onPropChange: function(conn, sender, object, iface, signal, param, user_data){
		print('RECV: '+signal+' '+this._path+user_data);
		if(signal == 'PropertiesChanged'){
			let sIface = param.get_child_value(0).get_string()[0];
			print("3"+param.get_child_value(2));

			if(sIface == 'org.mpris.MediaPlayer2.Player'){
				let sigs = param.get_child_value(1);
				for(let i = 0; i < sigs.n_children(); i++){
					let [key, val] = sigs.get_child_value(i).unpack();
					key = key.get_string()[0];
					val = val.unpack();

					if(key == 'Metadata')
						this._updateMetadata(val);
					if(key == 'PlaybackStatus')
						log('PS: '+val.get_string()[0]);

				}


			}
		}

	},

	_onMuteClick: function(){

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
				this._dbus.call_sync(this._path, '/org/mpris/MediaPlayer2', "org.freedesktop.DBus.Properties", "Get",
					GLib.Variant.new('(ssv)', [iface, property, value]), GLib.VariantType.new("(v)"),
					Gio.DBusCallFlags.NONE, -1, null);
				} catch(e){
				log('Laine: Exception setting value for ' +this._paPath +" :: "+e);
			}

	},


	_getPAProperty: function(property){
		try{
			let response = this._paDBusConnection.call_sync(null, this._paPath, 'org.freedesktop.DBus.Properties', 'Get',
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
				this._paDBusConnection.call_sync(null, this._paPath, 'org.freedesktop.DBus.Properties', 'Set',
					GLib.Variant.new('(ssv)', ['org.PulseAudio.Core1.Stream', property, value]), null, Gio.DBusCallFlags.NONE, -1, null);
			} catch(e){
				log('Laine: Exception setting value for ' +this._paPath +" :: "+e);
			}
	}
});






