/*
* jQuery Mobile Framework : "mouse" plugin
* Copyright (c) jQuery Project
* Dual licensed under the MIT or GPL Version 2 licenses.
* http://jquery.org/license
*/

// This plugin is an experiment for abstracting away the touch and mouse
// events so that developers don't have to worry about which method of input
// the device their document is loaded on supports.
//
// The idea here is to allow the developer to register listeners for the
// basic mouse events, such as mousedown, mousemove, mouseup, and click,
// and the plugin will take care of registering the correct listeners
// behind the scenes to invoke the listener at the fastest possible time
// for that device, while still retaining the order of event firing in
// the traditional mouse environment, should multiple handlers be registered
// on the same element for different events.
//
// The current version simply adds mBind and mUnbind to the $.fn space,
// but we're considering other methods for making this easier. One alternative
// would be to allow users to use virtual mouse event names, such as
// "vmousedown", "vmouseup", etc, to triggerVirtualEvent the traditional jQuery special/custom
// event api, which would then triggerVirtualEvent this same code.

(function($, window, document, undefined) {

var dataPropertyName = "virtualMouseBindings",
	touchTargetPropertyName = "virtualTouchID",
	virtualEventNames = "vmouseover vmousedown vmousemove vmouseup vclick vmouseout vmousecancel".split(" "),
	touchEventProps = "clientX clientY pageX pageY screenX screenY".split(" "),
	activeDocHandlers = {},
	resetTimerID = 0,
	startX = 0,
	startY = 0,
	startScrollX = 0,
	startScrollY = 0,
	didScroll = false,
	clickBlockList = [],
	blockMouseTriggers = false,
	scrollTopSupported = $.support.scrollTop,
	eventCaptureSupported = $.support.eventCapture,
	$document = $(document),
	nextTouchID = 1,
	lastTouchID = 0;

$.vmouse = {
	moveDistanceThreshold: 10,
	clickDistanceThreshold: 10,
	resetTimerDuration: 1500
};

function getNativeEvent(event)
{
	while (event && typeof event.originalEvent !== "undefined") {
		event = event.originalEvent;
	}
	return event;
}

function createVirtualEvent(event, eventType)
{
	var t = event.type;
	event = $.Event(event);
	event.type = eventType;
	
	var oe = event.originalEvent;
	var props = $.event.props;
	
	// copy original event properties over to the new event
	// this would happen if we could call $.event.fix instead of $.Event
	// but we don't have a way to force an event to be fixed multiple times
	if (oe) {
		for ( var i = props.length, prop; i; ) {
			prop = props[ --i ];
			event[prop] = oe[prop];
		}
	}
	
	if (t.search(/^touch/) !== -1){
		var ne = getNativeEvent(oe);
		if (typeof ne.touches !== "undefined" && ne.touches[0]){
			var touch = ne.touches[0];
			for (var i = 0; i < touchEventProps.length; i++){
				var prop = touchEventProps[i];
				event[prop] = touch[prop];
			}
		}
	}

	return event;
}

function getVirtualBindingFlags(element)
{
	var flags = {};
	var $ele = $(element);
	while ($ele && $ele.length){
		var b = $ele.data(dataPropertyName);
		for (var k in b) {
			if (b[k]){
				flags[k] = flags.hasVirtualBinding = true;
			}
		}
		$ele = $ele.parent();
	}
	return flags;
}

function getClosestElementWithVirtualBinding(element, eventType)
{
	var $ele = $(element);
	while ($ele && $ele.length){
		var b = $ele.data(dataPropertyName);
		if (b && (!eventType || b[eventType])) {
			return $ele;
		}
		$ele = $ele.parent();
	}
	return null;
}

function enableTouchBindings()
{
	if (!activeDocHandlers["touchbindings"]){
		$document.bind("touchend", handleTouchEnd)
		
			// On touch platforms, touching the screen and then dragging your finger
			// causes the window content to scroll after some distance threshold is
			// exceeded. On these platforms, a scroll prevents a click event from being
			// dispatched, and on some platforms, even the touchend is suppressed. To
			// mimic the suppression of the click event, we need to watch for a scroll
			// event. Unfortunately, some platforms like iOS don't dispatch scroll
			// events until *AFTER* the user lifts their finger (touchend). This means
			// we need to watch both scroll and touchmove events to figure out whether
			// or not a scroll happenens before the touchend event is fired.
		
			.bind("touchmove", handleTouchMove)
			.bind("scroll", handleScroll);

		activeDocHandlers["touchbindings"] = 1;
	}
}

function disableTouchBindings()
{
	if (activeDocHandlers["touchbindings"]){
		$document.unbind("touchmove", handleTouchMove)
			.unbind("touchend", handleTouchEnd)
			.unbind("scroll", handleScroll);
		activeDocHandlers["touchbindings"] = 0;
	}
}

function enableMouseBindings()
{
	lastTouchID = 0;
	clickBlockList.length = 0;
	blockMouseTriggers = false;

	// When mouse bindings are enabled, our
	// touch bindings are disabled.
	disableTouchBindings();
}

function disableMouseBindings()
{
	// When mouse bindings are disabled, our
	// touch bindings are enabled.
	enableTouchBindings();
}

function startResetTimer()
{
	clearResetTimer();
	resetTimerID = setTimeout(function(){
		resetTimerID = 0;
		enableMouseBindings();
	}, $.vmouse.resetTimerDuration);
}

function clearResetTimer()
{
	if (resetTimerID){
		clearTimeout(resetTimerID);
		resetTimerID = 0;
	}
}

function triggerVirtualEvent(eventType, event, flags)
{
	var defaultPrevented = false;

	if ((flags && flags[eventType]) || (!flags && getClosestElementWithVirtualBinding(event.target, eventType))) {
		var ve = createVirtualEvent(event, eventType);
		$(event.target).trigger(ve);
		defaultPrevented = ve.isDefaultPrevented();
	}

	return defaultPrevented;
}

function mouseEventCallback(event)
{
	var touchID = $(event.target).data(touchTargetPropertyName);
	if (!blockMouseTriggers && (!lastTouchID || lastTouchID !== touchID)){
		triggerVirtualEvent("v" + event.type, event);
	}
}

function handleTouchStart(event)
{
	var touches = getNativeEvent(event).touches;
	if (touches.length === 1){
		var target = event.target,
			flags = getVirtualBindingFlags(target);
	
		if (flags.hasVirtualBinding){
			lastTouchID = nextTouchID++;
			$(target).data(touchTargetPropertyName, lastTouchID);
	
			clearResetTimer();
			
			disableMouseBindings();
			didScroll = false;
			
			var t = getNativeEvent(event).touches[0];
			startX = t.pageX;
			startY = t.pageY;
		
			if (scrollTopSupported){
				startScrollX = window.pageXOffset;
				startScrollY = window.pageYOffset;
			}
		
			triggerVirtualEvent("vmouseover", event, flags);
			triggerVirtualEvent("vmousedown", event, flags);
		}
	}
}

function handleScroll(event)
{
	if (!didScroll){
		triggerVirtualEvent("vmousecancel", event, getVirtualBindingFlags(event.target));
	}

	didScroll = true;
	startResetTimer();
}

function handleTouchMove(event)
{
	var t = getNativeEvent(event).touches[0];

	var didCancel = didScroll
		moveThreshold = $.vmouse.moveDistanceThreshold;
	didScroll = didScroll
		|| (scrollTopSupported && (startScrollX != window.pageXOffset || startScrollY != window.pageYOffset))
		|| (Math.abs(t.pageX - startX) > moveThreshold || Math.abs(t.pageY - startY) > moveThreshold);

	var flags = getVirtualBindingFlags(event.target);
	if (didScroll && !didCancel){
		triggerVirtualEvent("vmousecancel", event, flags);
	}
	triggerVirtualEvent("vmousemove", event, flags);
	startResetTimer();
}

function handleTouchEnd(event)
{
	disableTouchBindings();

	var flags = getVirtualBindingFlags(event.target);
	triggerVirtualEvent("vmouseup", event, flags);
	if (!didScroll){
		if (triggerVirtualEvent("vclick", event, flags)){
			// The target of the mouse events that follow the touchend
			// event don't necessarily match the target used during the
			// touch. This means we need to rely on coordinates for blocking
			// any click that is generated.
			var t = getNativeEvent(event).changedTouches[0];
			clickBlockList.push({ x: t.clientX, y: t.clientY });

			// Prevent any mouse events that follow from triggering
			// virtual event notifications.
			blockMouseTriggers = true;
		}
	}
	triggerVirtualEvent("vmouseout", event, flags);
	didScroll = false;
	
	startResetTimer();
}

function hasVirtualBindings($ele)
{
	var bindings = $ele.data(dataPropertyName), k;
	if (bindings){
		for (k in bindings){
			if (bindings[k]){
				return true;
			}
		}
	}
	return false;
}

function getSpecialEventObject(eventType)
{
	return {
		setup: function(data, namespace) {
			// If this is the first virtual mouse binding for this element,
			// add a bindings object to its data.

			var $this = $(this);
			if (!hasVirtualBindings($this)){
				$this.data(dataPropertyName, {});
			}

			// If setup is called, we know it is the first binding for this
			// eventType, so initialize the count for the eventType to zero.

			var bindings = $this.data(dataPropertyName);
			bindings[eventType] = true;

			// If this is the first virtual mouse event for this type,
			// register a global handler on the document.

			activeDocHandlers[eventType] = (activeDocHandlers[eventType] || 0) + 1;
			if (activeDocHandlers[eventType] == 1){
				$document.bind(eventType.substr(1), mouseEventCallback);
			}

			// For now, if event capture is not supported, we rely on mouse handlers.
			if (eventCaptureSupported){
				// If this is the first virtual mouse binding for the document,
				// register our touchstart handler on the document.
	
				activeDocHandlers["touchstart"] = (activeDocHandlers["touchstart"] || 0) + 1;
				if (activeDocHandlers["touchstart"] == 1) {
					$document.bind("touchstart", handleTouchStart);
				}
			}
		},

		teardown: function(data, namespace) {
			// If this is the last virtual binding for this eventType,
			// remove its global handler from the document.

			--activeDocHandlers[eventType];
			if (!activeDocHandlers[eventType]){
				$document.unbind(eventType.substr(1), mouseEventCallback);
			}

			if (eventCaptureSupported){
				// If this is the last virtual mouse binding in existence,
				// remove our document touchstart listener.
	
				--activeDocHandlers["touchstart"];
				if (!activeDocHandlers["touchstart"]) {
					$document.unbind("touchstart", handleTouchStart);
				}
			}

			var $this = $(this),
				bindings = $this.data(dataPropertyName);
			bindings[eventType] = false;

			// If this is the last virtual mouse binding on the
			// element, remove the binding data from the element.

			var $this = $(this);
			if (!hasVirtualBindings($this)){
				$this.removeData(dataPropertyName);
			}
		}
	};
}

// Expose our custom events to the jQuery bind/unbind mechanism.

for (var i = 0; i < virtualEventNames.length; i++){
	$.event.special[virtualEventNames[i]] = getSpecialEventObject(virtualEventNames[i]);
}

// Add a capture click handler to block clicks.
// Note that we require event capture support for this so if the device
// doesn't support it, we punt for now and rely solely on mouse events.
if (eventCaptureSupported){
	document.addEventListener("click", function(e){
		var cnt = clickBlockList.length;
		var target = e.target;
		if (cnt) {
			var x = e.clientX,
				y = e.clientY,
				threshold = $.vmouse.clickDistanceThreshold;
			for (var i = 0; i < cnt; i++) {
				var o = clickBlockList[i];
				if (Math.abs(o.x - x) < threshold && Math.abs(o.y - y) < threshold){
					e.preventDefault();
					e.stopPropagation();
					return;
				}
			}
		}
	}, true);
}
})(jQuery, window, document);