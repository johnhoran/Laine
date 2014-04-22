const Gio = imports.gi.Gio;
const Lang = imports.lang;

const PAServerLookupIface = '<node>\
		<interface name="org.PulseAudio.ServerLookup1">\
			<property name="Address" type="s" access="read" />\
		</interface>\
	</node>';
const ServerLookupProxy = Gio.DBusProxy.makeProxyWrapper(PAServerLookupIface);

const PAIface = '<node>\
		<interface name="org.PulseAudio.Core1">\
			<property name="Name" type="s" access="read" />\
		</interface>\
	</node>';
const PAProxy = Gio.DBusProxy.makeProxyWrapper(PAIface);


const IntrospectProxy = Gio.DBusProxy.makeProxyWrapper('<node>\
		<interface name="org.freedesktop.DBus.Introspectable">\
			<method name="Introspect">\
				<arg name="data" type="s" direction="out"/>\
			</method>\
		</interface>\
	</node>');

function getServerAddress(){
	let conn = new ServerLookupProxy(Gio.DBus.session, 'org.PulseAudio1', '/org/pulseaudio/server_lookup1');
	return conn.Address;
}

function getPulseAudioConnection(){
	
	let paProxy = Gio.DBusConnection.new_for_address_sync(this.getServerAddress(), Gio.DBusConnectionFlags.NONE, null, null);
//print(paProxy);
//let conn = new PAProxy(paProxy, 'org.PulseAudio', '/org/pulseaudio/core1');
//	print(conn.Name);

	let introspect = new IntrospectProxy(paProxy, 'org.freedesktop.DBus.Introspectable', '/org/pulseaudio/core1');
	print(introspect.IntrospectSync());


}


this.getPulseAudioConnection();