Laine
=====

Gnome extension which allows the control of the volume of individual applications as well as a more in dept control of mpris aware applications from a single applet


How to use
----------
Firstly the extension requrires pulseaudio to be compiled with dbus support.  However if the module isn't loaded when the extension starts, then it will go ahead and load it manually.

On load the built-in volume indicator is hidden and replaced with a seperate one.

Clicking on any of the icons in the menu will mute/unmute the volume of that stream.
If there is more than one sink available to pulseaudio, then there will be a little drop down arrow next to its volume indicator showing a menu letting the user select the desired output.
Clicking on the label of an input stream, will attempt to switch to the window that owns that stream.  However this is done by process ID, so if a single proces has many windows, e.g. firefox, or doesn't let the window manager track it, e.g. minecraft, then it won't be able to switch and nothing will happen.
If a stream originates from an MPRIS application, then the stream will have some very basic controls as well as a small bit of information about the stream.

Credits
----------
I should say that this extension was inspired largly by two other excellent extensions,
[Advanced Volume Mixer](https://extensions.gnome.org/extension/212/advanced-volume-mixer/)
which the original developer seems to have stopped updating, which is why I initially decided to develop this, and
[Media player indicator](https://extensions.gnome.org/extension/55/media-player-indicator/).
