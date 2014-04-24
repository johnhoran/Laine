const Lang = imports.lang;
const St = imports.gi.St;
const Gvc = imports.gi.Gvc;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;
const Me = imports.misc.extensionUtils.getCurrentExtension();

const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Tweener = imports.ui.tweener;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;

const StreamMenu = Me.imports.streamMenu;

let _paDBusConnection;
function getPADBusConnection(){
  if(_paDBusConnection) return _paDBusConnection;
 
  let addr = 'unix:path=/run/user/1000/pulse/dbus-socket';//this.getServerAddress();
  try{
    _paDBusConnection = Gio.DBusConnection.new_for_address_sync(addr, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null);
  }
  catch(e){
    // Caught an exception, make sure pulseaudio has loaded dbus
    GLib.spawn_command_line_sync("pactl load-module module-dbus-protocol", null, null, null);
    _paDBusConnection = Gio.DBusConnection.new_for_address_sync(addr, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null);
  }
  return _paDBusConnection;
}

function getServerAddress(){
  let ServerLookupProxy = Gio.DBusProxy.makeProxyWrapper('<node>\
    <interface name="org.PulseAudio.ServerLookup1">\
      <property name="Address" type="s" access="read" />\
    </interface>\
  </node>');

  let conn = new ServerLookupProxy(Gio.DBus.session, 'org.PulseAudio1', '/org/pulseaudio/server_lookup1');
  let address = conn.Address;

  return address;
}


const Laine = new Lang.Class({
  Name: 'Laine',
  Extends: PanelMenu.Button,

  _init: function(){
    this.parent(0.0);
    this._paDBusConnection = getPADBusConnection();

    this._icon = new St.Icon({ icon_name: 'system-run-symbolic', style_class: 'system-status-icon' });
    this._mainMenu = new MainMenu(this._paDBusConnection);

    let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
    hbox.add_child(this._icon);


    this.actor.add_child(hbox);
    this.menu.addMenuItem(this._mainMenu);

    return 0;
  }
});

const MainMenu = new Lang.Class({
  Name: 'VolumeMenu',
  Extends: PopupMenu.PopupMenuSection,

  _init: function(control) {
    this.parent();

    let sourceMenu = new StreamMenu.StreamMenu(control);
    this.addMenuItem(sourceMenu);
  }
});


let _menuButton;

function init(){}

function enable(){
  _menuButton = new Laine();
  Main.panel.addToStatusArea('laine', _menuButton);
}

function disable(){
  _menuButton.destroy();
}