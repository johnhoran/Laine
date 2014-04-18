const Gio = imports.gi.Gio;
const Lang = imports.lang;

const PAServerLookupIface = '<node>\
		<interface name="org.PulseAudio.ServerLookup1">\
			<property name="Address" type="s" access="read" />\
		</interface>\
	</node>';
const ServerLookupProxy = Gio.DBusProxy.makeProxyWrapper(PAServerLookupIface);



function getServerAddress(){
	let conn = new ServerLookupProxy(Gio.DBus.session, 'org.PulseAudio1', '/org/pulseaudio/server_lookup1');
	return conn.Address;

}

print(Gio.DBus.session);

this.getServerAddress();