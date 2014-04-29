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

		this._songLbl = new St.Label({style_class:'mpris-description'});
		this._artistLbl = new St.Label({style_class:'mpris-description'});
		this._albumLbl = new St.Label({style_class:'mpris-description'});
		this._albumArt = new St.Icon({style_class:'album-art'});

		let metatdata = this._getDBusProperty('org.mpris.MediaPlayer2.Player', 'Metadata');
		this._handleMetadata(metatdata);

		let muteBtn = new St.Button({child: icon});
		let label = new St.Label({text:name, style_class: 'simple-stream-label', reactive: true});

		this._songLbl = new St.Label({style_class: 'mpris-info-label'});
		this._artistLbl = new St.Label({style_class: 'mpris-info-label'});
		this._albumLbl = new St.Label({style_class: 'mpris-info-label'});

		this.actor.add(muteBtn);
		this.actor.add(label);

		this.actor.add(this._songLbl);
		this.actor.add(this._artistLbl);
		this.actor.add(this._albumLbl);
		this.actor.add(this._albumArt);
	},

	setPAStream: function(path){
		this._paPath = path;
	},

	_handleMetadata: function(meta){
		log(meta);

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
			iconPath = filePath.substring(7, filePath.length);

			if(GLib.file_test(iconPath, GLib.FileTest.EXISTS)){
				let file = Gio.File.new_for_path(iconPath)
				let icon = new Gio.FileIcon({file:file});
				this._albumArt.gicon = icon;

				//	log(metaD['mpris:artUrl'].get_string()[0]);
			}
		}

		/*
'mpris:length'
'mpris:artUrl'*/
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