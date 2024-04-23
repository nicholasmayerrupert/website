(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const c of document.querySelectorAll('link[rel="modulepreload"]'))o(c);new MutationObserver(c=>{for(const d of c)if(d.type==="childList")for(const g of d.addedNodes)g.tagName==="LINK"&&g.rel==="modulepreload"&&o(g)}).observe(document,{childList:!0,subtree:!0});function a(c){const d={};return c.integrity&&(d.integrity=c.integrity),c.referrerPolicy&&(d.referrerPolicy=c.referrerPolicy),c.crossOrigin==="use-credentials"?d.credentials="include":c.crossOrigin==="anonymous"?d.credentials="omit":d.credentials="same-origin",d}function o(c){if(c.ep)return;c.ep=!0;const d=a(c);fetch(c.href,d)}})();var commonjsGlobal=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};function getDefaultExportFromCjs(s){return s&&s.__esModule&&Object.prototype.hasOwnProperty.call(s,"default")?s.default:s}var jsxRuntime={exports:{}},reactJsxRuntime_production_min={},react={exports:{}},react_production_min={};/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var l$1=Symbol.for("react.element"),n$1=Symbol.for("react.portal"),p$2=Symbol.for("react.fragment"),q$1=Symbol.for("react.strict_mode"),r=Symbol.for("react.profiler"),t=Symbol.for("react.provider"),u=Symbol.for("react.context"),v$2=Symbol.for("react.forward_ref"),w$1=Symbol.for("react.suspense"),x=Symbol.for("react.memo"),y=Symbol.for("react.lazy"),z$1=Symbol.iterator;function A$1(s){return s===null||typeof s!="object"?null:(s=z$1&&s[z$1]||s["@@iterator"],typeof s=="function"?s:null)}var B$1={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},C$1=Object.assign,D$1={};function E$1(s,e,a){this.props=s,this.context=e,this.refs=D$1,this.updater=a||B$1}E$1.prototype.isReactComponent={};E$1.prototype.setState=function(s,e){if(typeof s!="object"&&typeof s!="function"&&s!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,s,e,"setState")};E$1.prototype.forceUpdate=function(s){this.updater.enqueueForceUpdate(this,s,"forceUpdate")};function F(){}F.prototype=E$1.prototype;function G$1(s,e,a){this.props=s,this.context=e,this.refs=D$1,this.updater=a||B$1}var H$1=G$1.prototype=new F;H$1.constructor=G$1;C$1(H$1,E$1.prototype);H$1.isPureReactComponent=!0;var I$1=Array.isArray,J=Object.prototype.hasOwnProperty,K$1={current:null},L$1={key:!0,ref:!0,__self:!0,__source:!0};function M$1(s,e,a){var o,c={},d=null,g=null;if(e!=null)for(o in e.ref!==void 0&&(g=e.ref),e.key!==void 0&&(d=""+e.key),e)J.call(e,o)&&!L$1.hasOwnProperty(o)&&(c[o]=e[o]);var _=arguments.length-2;if(_===1)c.children=a;else if(1<_){for(var b=Array(_),$=0;$<_;$++)b[$]=arguments[$+2];c.children=b}if(s&&s.defaultProps)for(o in _=s.defaultProps,_)c[o]===void 0&&(c[o]=_[o]);return{$$typeof:l$1,type:s,key:d,ref:g,props:c,_owner:K$1.current}}function N$1(s,e){return{$$typeof:l$1,type:s.type,key:e,ref:s.ref,props:s.props,_owner:s._owner}}function O$1(s){return typeof s=="object"&&s!==null&&s.$$typeof===l$1}function escape(s){var e={"=":"=0",":":"=2"};return"$"+s.replace(/[=:]/g,function(a){return e[a]})}var P$1=/\/+/g;function Q$1(s,e){return typeof s=="object"&&s!==null&&s.key!=null?escape(""+s.key):e.toString(36)}function R$1(s,e,a,o,c){var d=typeof s;(d==="undefined"||d==="boolean")&&(s=null);var g=!1;if(s===null)g=!0;else switch(d){case"string":case"number":g=!0;break;case"object":switch(s.$$typeof){case l$1:case n$1:g=!0}}if(g)return g=s,c=c(g),s=o===""?"."+Q$1(g,0):o,I$1(c)?(a="",s!=null&&(a=s.replace(P$1,"$&/")+"/"),R$1(c,e,a,"",function($){return $})):c!=null&&(O$1(c)&&(c=N$1(c,a+(!c.key||g&&g.key===c.key?"":(""+c.key).replace(P$1,"$&/")+"/")+s)),e.push(c)),1;if(g=0,o=o===""?".":o+":",I$1(s))for(var _=0;_<s.length;_++){d=s[_];var b=o+Q$1(d,_);g+=R$1(d,e,a,b,c)}else if(b=A$1(s),typeof b=="function")for(s=b.call(s),_=0;!(d=s.next()).done;)d=d.value,b=o+Q$1(d,_++),g+=R$1(d,e,a,b,c);else if(d==="object")throw e=String(s),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(s).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return g}function S$1(s,e,a){if(s==null)return s;var o=[],c=0;return R$1(s,o,"","",function(d){return e.call(a,d,c++)}),o}function T$1(s){if(s._status===-1){var e=s._result;e=e(),e.then(function(a){(s._status===0||s._status===-1)&&(s._status=1,s._result=a)},function(a){(s._status===0||s._status===-1)&&(s._status=2,s._result=a)}),s._status===-1&&(s._status=0,s._result=e)}if(s._status===1)return s._result.default;throw s._result}var U$1={current:null},V$1={transition:null},W$1={ReactCurrentDispatcher:U$1,ReactCurrentBatchConfig:V$1,ReactCurrentOwner:K$1};react_production_min.Children={map:S$1,forEach:function(s,e,a){S$1(s,function(){e.apply(this,arguments)},a)},count:function(s){var e=0;return S$1(s,function(){e++}),e},toArray:function(s){return S$1(s,function(e){return e})||[]},only:function(s){if(!O$1(s))throw Error("React.Children.only expected to receive a single React element child.");return s}};react_production_min.Component=E$1;react_production_min.Fragment=p$2;react_production_min.Profiler=r;react_production_min.PureComponent=G$1;react_production_min.StrictMode=q$1;react_production_min.Suspense=w$1;react_production_min.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=W$1;react_production_min.cloneElement=function(s,e,a){if(s==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+s+".");var o=C$1({},s.props),c=s.key,d=s.ref,g=s._owner;if(e!=null){if(e.ref!==void 0&&(d=e.ref,g=K$1.current),e.key!==void 0&&(c=""+e.key),s.type&&s.type.defaultProps)var _=s.type.defaultProps;for(b in e)J.call(e,b)&&!L$1.hasOwnProperty(b)&&(o[b]=e[b]===void 0&&_!==void 0?_[b]:e[b])}var b=arguments.length-2;if(b===1)o.children=a;else if(1<b){_=Array(b);for(var $=0;$<b;$++)_[$]=arguments[$+2];o.children=_}return{$$typeof:l$1,type:s.type,key:c,ref:d,props:o,_owner:g}};react_production_min.createContext=function(s){return s={$$typeof:u,_currentValue:s,_currentValue2:s,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},s.Provider={$$typeof:t,_context:s},s.Consumer=s};react_production_min.createElement=M$1;react_production_min.createFactory=function(s){var e=M$1.bind(null,s);return e.type=s,e};react_production_min.createRef=function(){return{current:null}};react_production_min.forwardRef=function(s){return{$$typeof:v$2,render:s}};react_production_min.isValidElement=O$1;react_production_min.lazy=function(s){return{$$typeof:y,_payload:{_status:-1,_result:s},_init:T$1}};react_production_min.memo=function(s,e){return{$$typeof:x,type:s,compare:e===void 0?null:e}};react_production_min.startTransition=function(s){var e=V$1.transition;V$1.transition={};try{s()}finally{V$1.transition=e}};react_production_min.unstable_act=function(){throw Error("act(...) is not supported in production builds of React.")};react_production_min.useCallback=function(s,e){return U$1.current.useCallback(s,e)};react_production_min.useContext=function(s){return U$1.current.useContext(s)};react_production_min.useDebugValue=function(){};react_production_min.useDeferredValue=function(s){return U$1.current.useDeferredValue(s)};react_production_min.useEffect=function(s,e){return U$1.current.useEffect(s,e)};react_production_min.useId=function(){return U$1.current.useId()};react_production_min.useImperativeHandle=function(s,e,a){return U$1.current.useImperativeHandle(s,e,a)};react_production_min.useInsertionEffect=function(s,e){return U$1.current.useInsertionEffect(s,e)};react_production_min.useLayoutEffect=function(s,e){return U$1.current.useLayoutEffect(s,e)};react_production_min.useMemo=function(s,e){return U$1.current.useMemo(s,e)};react_production_min.useReducer=function(s,e,a){return U$1.current.useReducer(s,e,a)};react_production_min.useRef=function(s){return U$1.current.useRef(s)};react_production_min.useState=function(s){return U$1.current.useState(s)};react_production_min.useSyncExternalStore=function(s,e,a){return U$1.current.useSyncExternalStore(s,e,a)};react_production_min.useTransition=function(){return U$1.current.useTransition()};react_production_min.version="18.2.0";react.exports=react_production_min;var reactExports=react.exports;const React=getDefaultExportFromCjs(reactExports);/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var f=reactExports,k$1=Symbol.for("react.element"),l=Symbol.for("react.fragment"),m$1=Object.prototype.hasOwnProperty,n=f.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,p$1={key:!0,ref:!0,__self:!0,__source:!0};function q(s,e,a){var o,c={},d=null,g=null;a!==void 0&&(d=""+a),e.key!==void 0&&(d=""+e.key),e.ref!==void 0&&(g=e.ref);for(o in e)m$1.call(e,o)&&!p$1.hasOwnProperty(o)&&(c[o]=e[o]);if(s&&s.defaultProps)for(o in e=s.defaultProps,e)c[o]===void 0&&(c[o]=e[o]);return{$$typeof:k$1,type:s,key:d,ref:g,props:c,_owner:n.current}}reactJsxRuntime_production_min.Fragment=l;reactJsxRuntime_production_min.jsx=q;reactJsxRuntime_production_min.jsxs=q;jsxRuntime.exports=reactJsxRuntime_production_min;var jsxRuntimeExports=jsxRuntime.exports,client={},reactDom={exports:{}},reactDom_production_min={},scheduler={exports:{}},scheduler_production_min={};/**
 * @license React
 * scheduler.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */(function(s){function e(ut,dt){var Mt=ut.length;ut.push(dt);e:for(;0<Mt;){var At=Mt-1>>>1,Bt=ut[At];if(0<c(Bt,dt))ut[At]=dt,ut[Mt]=Bt,Mt=At;else break e}}function a(ut){return ut.length===0?null:ut[0]}function o(ut){if(ut.length===0)return null;var dt=ut[0],Mt=ut.pop();if(Mt!==dt){ut[0]=Mt;e:for(var At=0,Bt=ut.length,Xt=Bt>>>1;At<Xt;){var It=2*(At+1)-1,Vt=ut[It],Wt=It+1,Kt=ut[Wt];if(0>c(Vt,Mt))Wt<Bt&&0>c(Kt,Vt)?(ut[At]=Kt,ut[Wt]=Mt,At=Wt):(ut[At]=Vt,ut[It]=Mt,At=It);else if(Wt<Bt&&0>c(Kt,Mt))ut[At]=Kt,ut[Wt]=Mt,At=Wt;else break e}}return dt}function c(ut,dt){var Mt=ut.sortIndex-dt.sortIndex;return Mt!==0?Mt:ut.id-dt.id}if(typeof performance=="object"&&typeof performance.now=="function"){var d=performance;s.unstable_now=function(){return d.now()}}else{var g=Date,_=g.now();s.unstable_now=function(){return g.now()-_}}var b=[],$=[],tt=1,rt=null,et=3,st=!1,ot=!1,at=!1,lt=typeof setTimeout=="function"?setTimeout:null,_e=typeof clearTimeout=="function"?clearTimeout:null,it=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function nt(ut){for(var dt=a($);dt!==null;){if(dt.callback===null)o($);else if(dt.startTime<=ut)o($),dt.sortIndex=dt.expirationTime,e(b,dt);else break;dt=a($)}}function ct(ut){if(at=!1,nt(ut),!ot)if(a(b)!==null)ot=!0,_t(ht);else{var dt=a($);dt!==null&&St(ct,dt.startTime-ut)}}function ht(ut,dt){ot=!1,at&&(at=!1,_e(yt),yt=-1),st=!0;var Mt=et;try{for(nt(dt),rt=a(b);rt!==null&&(!(rt.expirationTime>dt)||ut&&!Ct());){var At=rt.callback;if(typeof At=="function"){rt.callback=null,et=rt.priorityLevel;var Bt=At(rt.expirationTime<=dt);dt=s.unstable_now(),typeof Bt=="function"?rt.callback=Bt:rt===a(b)&&o(b),nt(dt)}else o(b);rt=a(b)}if(rt!==null)var Xt=!0;else{var It=a($);It!==null&&St(ct,It.startTime-dt),Xt=!1}return Xt}finally{rt=null,et=Mt,st=!1}}var ft=!1,pt=null,yt=-1,vt=5,gt=-1;function Ct(){return!(s.unstable_now()-gt<vt)}function Pt(){if(pt!==null){var ut=s.unstable_now();gt=ut;var dt=!0;try{dt=pt(!0,ut)}finally{dt?Tt():(ft=!1,pt=null)}}else ft=!1}var Tt;if(typeof it=="function")Tt=function(){it(Pt)};else if(typeof MessageChannel<"u"){var Rt=new MessageChannel,wt=Rt.port2;Rt.port1.onmessage=Pt,Tt=function(){wt.postMessage(null)}}else Tt=function(){lt(Pt,0)};function _t(ut){pt=ut,ft||(ft=!0,Tt())}function St(ut,dt){yt=lt(function(){ut(s.unstable_now())},dt)}s.unstable_IdlePriority=5,s.unstable_ImmediatePriority=1,s.unstable_LowPriority=4,s.unstable_NormalPriority=3,s.unstable_Profiling=null,s.unstable_UserBlockingPriority=2,s.unstable_cancelCallback=function(ut){ut.callback=null},s.unstable_continueExecution=function(){ot||st||(ot=!0,_t(ht))},s.unstable_forceFrameRate=function(ut){0>ut||125<ut?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):vt=0<ut?Math.floor(1e3/ut):5},s.unstable_getCurrentPriorityLevel=function(){return et},s.unstable_getFirstCallbackNode=function(){return a(b)},s.unstable_next=function(ut){switch(et){case 1:case 2:case 3:var dt=3;break;default:dt=et}var Mt=et;et=dt;try{return ut()}finally{et=Mt}},s.unstable_pauseExecution=function(){},s.unstable_requestPaint=function(){},s.unstable_runWithPriority=function(ut,dt){switch(ut){case 1:case 2:case 3:case 4:case 5:break;default:ut=3}var Mt=et;et=ut;try{return dt()}finally{et=Mt}},s.unstable_scheduleCallback=function(ut,dt,Mt){var At=s.unstable_now();switch(typeof Mt=="object"&&Mt!==null?(Mt=Mt.delay,Mt=typeof Mt=="number"&&0<Mt?At+Mt:At):Mt=At,ut){case 1:var Bt=-1;break;case 2:Bt=250;break;case 5:Bt=1073741823;break;case 4:Bt=1e4;break;default:Bt=5e3}return Bt=Mt+Bt,ut={id:tt++,callback:dt,priorityLevel:ut,startTime:Mt,expirationTime:Bt,sortIndex:-1},Mt>At?(ut.sortIndex=Mt,e($,ut),a(b)===null&&ut===a($)&&(at?(_e(yt),yt=-1):at=!0,St(ct,Mt-At))):(ut.sortIndex=Bt,e(b,ut),ot||st||(ot=!0,_t(ht))),ut},s.unstable_shouldYield=Ct,s.unstable_wrapCallback=function(ut){var dt=et;return function(){var Mt=et;et=dt;try{return ut.apply(this,arguments)}finally{et=Mt}}}})(scheduler_production_min);scheduler.exports=scheduler_production_min;var schedulerExports=scheduler.exports;/**
 * @license React
 * react-dom.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var aa=reactExports,ca=schedulerExports;function p(s){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+s,a=1;a<arguments.length;a++)e+="&args[]="+encodeURIComponent(arguments[a]);return"Minified React error #"+s+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var da=new Set,ea={};function fa(s,e){ha(s,e),ha(s+"Capture",e)}function ha(s,e){for(ea[s]=e,s=0;s<e.length;s++)da.add(e[s])}var ia=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),ja=Object.prototype.hasOwnProperty,ka=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,la={},ma={};function oa(s){return ja.call(ma,s)?!0:ja.call(la,s)?!1:ka.test(s)?ma[s]=!0:(la[s]=!0,!1)}function pa(s,e,a,o){if(a!==null&&a.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return o?!1:a!==null?!a.acceptsBooleans:(s=s.toLowerCase().slice(0,5),s!=="data-"&&s!=="aria-");default:return!1}}function qa(s,e,a,o){if(e===null||typeof e>"u"||pa(s,e,a,o))return!0;if(o)return!1;if(a!==null)switch(a.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function v$1(s,e,a,o,c,d,g){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=o,this.attributeNamespace=c,this.mustUseProperty=a,this.propertyName=s,this.type=e,this.sanitizeURL=d,this.removeEmptyString=g}var z={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(s){z[s]=new v$1(s,0,!1,s,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(s){var e=s[0];z[e]=new v$1(e,1,!1,s[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(s){z[s]=new v$1(s,2,!1,s.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(s){z[s]=new v$1(s,2,!1,s,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(s){z[s]=new v$1(s,3,!1,s.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(s){z[s]=new v$1(s,3,!0,s,null,!1,!1)});["capture","download"].forEach(function(s){z[s]=new v$1(s,4,!1,s,null,!1,!1)});["cols","rows","size","span"].forEach(function(s){z[s]=new v$1(s,6,!1,s,null,!1,!1)});["rowSpan","start"].forEach(function(s){z[s]=new v$1(s,5,!1,s.toLowerCase(),null,!1,!1)});var ra=/[\-:]([a-z])/g;function sa(s){return s[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(s){var e=s.replace(ra,sa);z[e]=new v$1(e,1,!1,s,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(s){var e=s.replace(ra,sa);z[e]=new v$1(e,1,!1,s,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(s){var e=s.replace(ra,sa);z[e]=new v$1(e,1,!1,s,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(s){z[s]=new v$1(s,1,!1,s.toLowerCase(),null,!1,!1)});z.xlinkHref=new v$1("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(s){z[s]=new v$1(s,1,!1,s.toLowerCase(),null,!0,!0)});function ta(s,e,a,o){var c=z.hasOwnProperty(e)?z[e]:null;(c!==null?c.type!==0:o||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(qa(e,a,c,o)&&(a=null),o||c===null?oa(e)&&(a===null?s.removeAttribute(e):s.setAttribute(e,""+a)):c.mustUseProperty?s[c.propertyName]=a===null?c.type===3?!1:"":a:(e=c.attributeName,o=c.attributeNamespace,a===null?s.removeAttribute(e):(c=c.type,a=c===3||c===4&&a===!0?"":""+a,o?s.setAttributeNS(o,e,a):s.setAttribute(e,a))))}var ua=aa.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,va=Symbol.for("react.element"),wa=Symbol.for("react.portal"),ya=Symbol.for("react.fragment"),za=Symbol.for("react.strict_mode"),Aa=Symbol.for("react.profiler"),Ba=Symbol.for("react.provider"),Ca=Symbol.for("react.context"),Da=Symbol.for("react.forward_ref"),Ea=Symbol.for("react.suspense"),Fa=Symbol.for("react.suspense_list"),Ga=Symbol.for("react.memo"),Ha=Symbol.for("react.lazy"),Ia=Symbol.for("react.offscreen"),Ja=Symbol.iterator;function Ka(s){return s===null||typeof s!="object"?null:(s=Ja&&s[Ja]||s["@@iterator"],typeof s=="function"?s:null)}var A=Object.assign,La;function Ma(s){if(La===void 0)try{throw Error()}catch(a){var e=a.stack.trim().match(/\n( *(at )?)/);La=e&&e[1]||""}return`
`+La+s}var Na=!1;function Oa(s,e){if(!s||Na)return"";Na=!0;var a=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch($){var o=$}Reflect.construct(s,[],e)}else{try{e.call()}catch($){o=$}s.call(e.prototype)}else{try{throw Error()}catch($){o=$}s()}}catch($){if($&&o&&typeof $.stack=="string"){for(var c=$.stack.split(`
`),d=o.stack.split(`
`),g=c.length-1,_=d.length-1;1<=g&&0<=_&&c[g]!==d[_];)_--;for(;1<=g&&0<=_;g--,_--)if(c[g]!==d[_]){if(g!==1||_!==1)do if(g--,_--,0>_||c[g]!==d[_]){var b=`
`+c[g].replace(" at new "," at ");return s.displayName&&b.includes("<anonymous>")&&(b=b.replace("<anonymous>",s.displayName)),b}while(1<=g&&0<=_);break}}}finally{Na=!1,Error.prepareStackTrace=a}return(s=s?s.displayName||s.name:"")?Ma(s):""}function Pa(s){switch(s.tag){case 5:return Ma(s.type);case 16:return Ma("Lazy");case 13:return Ma("Suspense");case 19:return Ma("SuspenseList");case 0:case 2:case 15:return s=Oa(s.type,!1),s;case 11:return s=Oa(s.type.render,!1),s;case 1:return s=Oa(s.type,!0),s;default:return""}}function Qa(s){if(s==null)return null;if(typeof s=="function")return s.displayName||s.name||null;if(typeof s=="string")return s;switch(s){case ya:return"Fragment";case wa:return"Portal";case Aa:return"Profiler";case za:return"StrictMode";case Ea:return"Suspense";case Fa:return"SuspenseList"}if(typeof s=="object")switch(s.$$typeof){case Ca:return(s.displayName||"Context")+".Consumer";case Ba:return(s._context.displayName||"Context")+".Provider";case Da:var e=s.render;return s=s.displayName,s||(s=e.displayName||e.name||"",s=s!==""?"ForwardRef("+s+")":"ForwardRef"),s;case Ga:return e=s.displayName||null,e!==null?e:Qa(s.type)||"Memo";case Ha:e=s._payload,s=s._init;try{return Qa(s(e))}catch{}}return null}function Ra(s){var e=s.type;switch(s.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return s=e.render,s=s.displayName||s.name||"",e.displayName||(s!==""?"ForwardRef("+s+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return Qa(e);case 8:return e===za?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function Sa(s){switch(typeof s){case"boolean":case"number":case"string":case"undefined":return s;case"object":return s;default:return""}}function Ta(s){var e=s.type;return(s=s.nodeName)&&s.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function Ua(s){var e=Ta(s)?"checked":"value",a=Object.getOwnPropertyDescriptor(s.constructor.prototype,e),o=""+s[e];if(!s.hasOwnProperty(e)&&typeof a<"u"&&typeof a.get=="function"&&typeof a.set=="function"){var c=a.get,d=a.set;return Object.defineProperty(s,e,{configurable:!0,get:function(){return c.call(this)},set:function(g){o=""+g,d.call(this,g)}}),Object.defineProperty(s,e,{enumerable:a.enumerable}),{getValue:function(){return o},setValue:function(g){o=""+g},stopTracking:function(){s._valueTracker=null,delete s[e]}}}}function Va(s){s._valueTracker||(s._valueTracker=Ua(s))}function Wa(s){if(!s)return!1;var e=s._valueTracker;if(!e)return!0;var a=e.getValue(),o="";return s&&(o=Ta(s)?s.checked?"true":"false":s.value),s=o,s!==a?(e.setValue(s),!0):!1}function Xa(s){if(s=s||(typeof document<"u"?document:void 0),typeof s>"u")return null;try{return s.activeElement||s.body}catch{return s.body}}function Ya(s,e){var a=e.checked;return A({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:a??s._wrapperState.initialChecked})}function Za(s,e){var a=e.defaultValue==null?"":e.defaultValue,o=e.checked!=null?e.checked:e.defaultChecked;a=Sa(e.value!=null?e.value:a),s._wrapperState={initialChecked:o,initialValue:a,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function ab(s,e){e=e.checked,e!=null&&ta(s,"checked",e,!1)}function bb(s,e){ab(s,e);var a=Sa(e.value),o=e.type;if(a!=null)o==="number"?(a===0&&s.value===""||s.value!=a)&&(s.value=""+a):s.value!==""+a&&(s.value=""+a);else if(o==="submit"||o==="reset"){s.removeAttribute("value");return}e.hasOwnProperty("value")?cb(s,e.type,a):e.hasOwnProperty("defaultValue")&&cb(s,e.type,Sa(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(s.defaultChecked=!!e.defaultChecked)}function db(s,e,a){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var o=e.type;if(!(o!=="submit"&&o!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+s._wrapperState.initialValue,a||e===s.value||(s.value=e),s.defaultValue=e}a=s.name,a!==""&&(s.name=""),s.defaultChecked=!!s._wrapperState.initialChecked,a!==""&&(s.name=a)}function cb(s,e,a){(e!=="number"||Xa(s.ownerDocument)!==s)&&(a==null?s.defaultValue=""+s._wrapperState.initialValue:s.defaultValue!==""+a&&(s.defaultValue=""+a))}var eb=Array.isArray;function fb(s,e,a,o){if(s=s.options,e){e={};for(var c=0;c<a.length;c++)e["$"+a[c]]=!0;for(a=0;a<s.length;a++)c=e.hasOwnProperty("$"+s[a].value),s[a].selected!==c&&(s[a].selected=c),c&&o&&(s[a].defaultSelected=!0)}else{for(a=""+Sa(a),e=null,c=0;c<s.length;c++){if(s[c].value===a){s[c].selected=!0,o&&(s[c].defaultSelected=!0);return}e!==null||s[c].disabled||(e=s[c])}e!==null&&(e.selected=!0)}}function gb(s,e){if(e.dangerouslySetInnerHTML!=null)throw Error(p(91));return A({},e,{value:void 0,defaultValue:void 0,children:""+s._wrapperState.initialValue})}function hb(s,e){var a=e.value;if(a==null){if(a=e.children,e=e.defaultValue,a!=null){if(e!=null)throw Error(p(92));if(eb(a)){if(1<a.length)throw Error(p(93));a=a[0]}e=a}e==null&&(e=""),a=e}s._wrapperState={initialValue:Sa(a)}}function ib(s,e){var a=Sa(e.value),o=Sa(e.defaultValue);a!=null&&(a=""+a,a!==s.value&&(s.value=a),e.defaultValue==null&&s.defaultValue!==a&&(s.defaultValue=a)),o!=null&&(s.defaultValue=""+o)}function jb(s){var e=s.textContent;e===s._wrapperState.initialValue&&e!==""&&e!==null&&(s.value=e)}function kb(s){switch(s){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function lb(s,e){return s==null||s==="http://www.w3.org/1999/xhtml"?kb(e):s==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":s}var mb,nb=function(s){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,a,o,c){MSApp.execUnsafeLocalFunction(function(){return s(e,a,o,c)})}:s}(function(s,e){if(s.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in s)s.innerHTML=e;else{for(mb=mb||document.createElement("div"),mb.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=mb.firstChild;s.firstChild;)s.removeChild(s.firstChild);for(;e.firstChild;)s.appendChild(e.firstChild)}});function ob(s,e){if(e){var a=s.firstChild;if(a&&a===s.lastChild&&a.nodeType===3){a.nodeValue=e;return}}s.textContent=e}var pb={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},qb=["Webkit","ms","Moz","O"];Object.keys(pb).forEach(function(s){qb.forEach(function(e){e=e+s.charAt(0).toUpperCase()+s.substring(1),pb[e]=pb[s]})});function rb(s,e,a){return e==null||typeof e=="boolean"||e===""?"":a||typeof e!="number"||e===0||pb.hasOwnProperty(s)&&pb[s]?(""+e).trim():e+"px"}function sb(s,e){s=s.style;for(var a in e)if(e.hasOwnProperty(a)){var o=a.indexOf("--")===0,c=rb(a,e[a],o);a==="float"&&(a="cssFloat"),o?s.setProperty(a,c):s[a]=c}}var tb=A({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function ub(s,e){if(e){if(tb[s]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(p(137,s));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(p(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(p(61))}if(e.style!=null&&typeof e.style!="object")throw Error(p(62))}}function vb(s,e){if(s.indexOf("-")===-1)return typeof e.is=="string";switch(s){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var wb=null;function xb(s){return s=s.target||s.srcElement||window,s.correspondingUseElement&&(s=s.correspondingUseElement),s.nodeType===3?s.parentNode:s}var yb=null,zb=null,Ab=null;function Bb(s){if(s=Cb(s)){if(typeof yb!="function")throw Error(p(280));var e=s.stateNode;e&&(e=Db(e),yb(s.stateNode,s.type,e))}}function Eb(s){zb?Ab?Ab.push(s):Ab=[s]:zb=s}function Fb(){if(zb){var s=zb,e=Ab;if(Ab=zb=null,Bb(s),e)for(s=0;s<e.length;s++)Bb(e[s])}}function Gb(s,e){return s(e)}function Hb(){}var Ib=!1;function Jb(s,e,a){if(Ib)return s(e,a);Ib=!0;try{return Gb(s,e,a)}finally{Ib=!1,(zb!==null||Ab!==null)&&(Hb(),Fb())}}function Kb(s,e){var a=s.stateNode;if(a===null)return null;var o=Db(a);if(o===null)return null;a=o[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(o=!o.disabled)||(s=s.type,o=!(s==="button"||s==="input"||s==="select"||s==="textarea")),s=!o;break e;default:s=!1}if(s)return null;if(a&&typeof a!="function")throw Error(p(231,e,typeof a));return a}var Lb=!1;if(ia)try{var Mb={};Object.defineProperty(Mb,"passive",{get:function(){Lb=!0}}),window.addEventListener("test",Mb,Mb),window.removeEventListener("test",Mb,Mb)}catch{Lb=!1}function Nb(s,e,a,o,c,d,g,_,b){var $=Array.prototype.slice.call(arguments,3);try{e.apply(a,$)}catch(tt){this.onError(tt)}}var Ob=!1,Pb=null,Qb=!1,Rb=null,Sb={onError:function(s){Ob=!0,Pb=s}};function Tb(s,e,a,o,c,d,g,_,b){Ob=!1,Pb=null,Nb.apply(Sb,arguments)}function Ub(s,e,a,o,c,d,g,_,b){if(Tb.apply(this,arguments),Ob){if(Ob){var $=Pb;Ob=!1,Pb=null}else throw Error(p(198));Qb||(Qb=!0,Rb=$)}}function Vb(s){var e=s,a=s;if(s.alternate)for(;e.return;)e=e.return;else{s=e;do e=s,e.flags&4098&&(a=e.return),s=e.return;while(s)}return e.tag===3?a:null}function Wb(s){if(s.tag===13){var e=s.memoizedState;if(e===null&&(s=s.alternate,s!==null&&(e=s.memoizedState)),e!==null)return e.dehydrated}return null}function Xb(s){if(Vb(s)!==s)throw Error(p(188))}function Yb(s){var e=s.alternate;if(!e){if(e=Vb(s),e===null)throw Error(p(188));return e!==s?null:s}for(var a=s,o=e;;){var c=a.return;if(c===null)break;var d=c.alternate;if(d===null){if(o=c.return,o!==null){a=o;continue}break}if(c.child===d.child){for(d=c.child;d;){if(d===a)return Xb(c),s;if(d===o)return Xb(c),e;d=d.sibling}throw Error(p(188))}if(a.return!==o.return)a=c,o=d;else{for(var g=!1,_=c.child;_;){if(_===a){g=!0,a=c,o=d;break}if(_===o){g=!0,o=c,a=d;break}_=_.sibling}if(!g){for(_=d.child;_;){if(_===a){g=!0,a=d,o=c;break}if(_===o){g=!0,o=d,a=c;break}_=_.sibling}if(!g)throw Error(p(189))}}if(a.alternate!==o)throw Error(p(190))}if(a.tag!==3)throw Error(p(188));return a.stateNode.current===a?s:e}function Zb(s){return s=Yb(s),s!==null?$b(s):null}function $b(s){if(s.tag===5||s.tag===6)return s;for(s=s.child;s!==null;){var e=$b(s);if(e!==null)return e;s=s.sibling}return null}var ac=ca.unstable_scheduleCallback,bc=ca.unstable_cancelCallback,cc=ca.unstable_shouldYield,dc=ca.unstable_requestPaint,B=ca.unstable_now,ec=ca.unstable_getCurrentPriorityLevel,fc=ca.unstable_ImmediatePriority,gc=ca.unstable_UserBlockingPriority,hc=ca.unstable_NormalPriority,ic=ca.unstable_LowPriority,jc=ca.unstable_IdlePriority,kc=null,lc=null;function mc(s){if(lc&&typeof lc.onCommitFiberRoot=="function")try{lc.onCommitFiberRoot(kc,s,void 0,(s.current.flags&128)===128)}catch{}}var oc=Math.clz32?Math.clz32:nc,pc=Math.log,qc=Math.LN2;function nc(s){return s>>>=0,s===0?32:31-(pc(s)/qc|0)|0}var rc=64,sc=4194304;function tc(s){switch(s&-s){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return s&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return s&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return s}}function uc(s,e){var a=s.pendingLanes;if(a===0)return 0;var o=0,c=s.suspendedLanes,d=s.pingedLanes,g=a&268435455;if(g!==0){var _=g&~c;_!==0?o=tc(_):(d&=g,d!==0&&(o=tc(d)))}else g=a&~c,g!==0?o=tc(g):d!==0&&(o=tc(d));if(o===0)return 0;if(e!==0&&e!==o&&!(e&c)&&(c=o&-o,d=e&-e,c>=d||c===16&&(d&4194240)!==0))return e;if(o&4&&(o|=a&16),e=s.entangledLanes,e!==0)for(s=s.entanglements,e&=o;0<e;)a=31-oc(e),c=1<<a,o|=s[a],e&=~c;return o}function vc(s,e){switch(s){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function wc(s,e){for(var a=s.suspendedLanes,o=s.pingedLanes,c=s.expirationTimes,d=s.pendingLanes;0<d;){var g=31-oc(d),_=1<<g,b=c[g];b===-1?(!(_&a)||_&o)&&(c[g]=vc(_,e)):b<=e&&(s.expiredLanes|=_),d&=~_}}function xc(s){return s=s.pendingLanes&-1073741825,s!==0?s:s&1073741824?1073741824:0}function yc(){var s=rc;return rc<<=1,!(rc&4194240)&&(rc=64),s}function zc(s){for(var e=[],a=0;31>a;a++)e.push(s);return e}function Ac(s,e,a){s.pendingLanes|=e,e!==536870912&&(s.suspendedLanes=0,s.pingedLanes=0),s=s.eventTimes,e=31-oc(e),s[e]=a}function Bc(s,e){var a=s.pendingLanes&~e;s.pendingLanes=e,s.suspendedLanes=0,s.pingedLanes=0,s.expiredLanes&=e,s.mutableReadLanes&=e,s.entangledLanes&=e,e=s.entanglements;var o=s.eventTimes;for(s=s.expirationTimes;0<a;){var c=31-oc(a),d=1<<c;e[c]=0,o[c]=-1,s[c]=-1,a&=~d}}function Cc(s,e){var a=s.entangledLanes|=e;for(s=s.entanglements;a;){var o=31-oc(a),c=1<<o;c&e|s[o]&e&&(s[o]|=e),a&=~c}}var C=0;function Dc(s){return s&=-s,1<s?4<s?s&268435455?16:536870912:4:1}var Ec,Fc,Gc,Hc,Ic,Jc=!1,Kc=[],Lc=null,Mc=null,Nc=null,Oc=new Map,Pc=new Map,Qc=[],Rc="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function Sc(s,e){switch(s){case"focusin":case"focusout":Lc=null;break;case"dragenter":case"dragleave":Mc=null;break;case"mouseover":case"mouseout":Nc=null;break;case"pointerover":case"pointerout":Oc.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":Pc.delete(e.pointerId)}}function Tc(s,e,a,o,c,d){return s===null||s.nativeEvent!==d?(s={blockedOn:e,domEventName:a,eventSystemFlags:o,nativeEvent:d,targetContainers:[c]},e!==null&&(e=Cb(e),e!==null&&Fc(e)),s):(s.eventSystemFlags|=o,e=s.targetContainers,c!==null&&e.indexOf(c)===-1&&e.push(c),s)}function Uc(s,e,a,o,c){switch(e){case"focusin":return Lc=Tc(Lc,s,e,a,o,c),!0;case"dragenter":return Mc=Tc(Mc,s,e,a,o,c),!0;case"mouseover":return Nc=Tc(Nc,s,e,a,o,c),!0;case"pointerover":var d=c.pointerId;return Oc.set(d,Tc(Oc.get(d)||null,s,e,a,o,c)),!0;case"gotpointercapture":return d=c.pointerId,Pc.set(d,Tc(Pc.get(d)||null,s,e,a,o,c)),!0}return!1}function Vc(s){var e=Wc(s.target);if(e!==null){var a=Vb(e);if(a!==null){if(e=a.tag,e===13){if(e=Wb(a),e!==null){s.blockedOn=e,Ic(s.priority,function(){Gc(a)});return}}else if(e===3&&a.stateNode.current.memoizedState.isDehydrated){s.blockedOn=a.tag===3?a.stateNode.containerInfo:null;return}}}s.blockedOn=null}function Xc(s){if(s.blockedOn!==null)return!1;for(var e=s.targetContainers;0<e.length;){var a=Yc(s.domEventName,s.eventSystemFlags,e[0],s.nativeEvent);if(a===null){a=s.nativeEvent;var o=new a.constructor(a.type,a);wb=o,a.target.dispatchEvent(o),wb=null}else return e=Cb(a),e!==null&&Fc(e),s.blockedOn=a,!1;e.shift()}return!0}function Zc(s,e,a){Xc(s)&&a.delete(e)}function $c(){Jc=!1,Lc!==null&&Xc(Lc)&&(Lc=null),Mc!==null&&Xc(Mc)&&(Mc=null),Nc!==null&&Xc(Nc)&&(Nc=null),Oc.forEach(Zc),Pc.forEach(Zc)}function ad(s,e){s.blockedOn===e&&(s.blockedOn=null,Jc||(Jc=!0,ca.unstable_scheduleCallback(ca.unstable_NormalPriority,$c)))}function bd(s){function e(c){return ad(c,s)}if(0<Kc.length){ad(Kc[0],s);for(var a=1;a<Kc.length;a++){var o=Kc[a];o.blockedOn===s&&(o.blockedOn=null)}}for(Lc!==null&&ad(Lc,s),Mc!==null&&ad(Mc,s),Nc!==null&&ad(Nc,s),Oc.forEach(e),Pc.forEach(e),a=0;a<Qc.length;a++)o=Qc[a],o.blockedOn===s&&(o.blockedOn=null);for(;0<Qc.length&&(a=Qc[0],a.blockedOn===null);)Vc(a),a.blockedOn===null&&Qc.shift()}var cd=ua.ReactCurrentBatchConfig,dd=!0;function ed(s,e,a,o){var c=C,d=cd.transition;cd.transition=null;try{C=1,fd(s,e,a,o)}finally{C=c,cd.transition=d}}function gd(s,e,a,o){var c=C,d=cd.transition;cd.transition=null;try{C=4,fd(s,e,a,o)}finally{C=c,cd.transition=d}}function fd(s,e,a,o){if(dd){var c=Yc(s,e,a,o);if(c===null)hd(s,e,o,id$2,a),Sc(s,o);else if(Uc(c,s,e,a,o))o.stopPropagation();else if(Sc(s,o),e&4&&-1<Rc.indexOf(s)){for(;c!==null;){var d=Cb(c);if(d!==null&&Ec(d),d=Yc(s,e,a,o),d===null&&hd(s,e,o,id$2,a),d===c)break;c=d}c!==null&&o.stopPropagation()}else hd(s,e,o,null,a)}}var id$2=null;function Yc(s,e,a,o){if(id$2=null,s=xb(o),s=Wc(s),s!==null)if(e=Vb(s),e===null)s=null;else if(a=e.tag,a===13){if(s=Wb(e),s!==null)return s;s=null}else if(a===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;s=null}else e!==s&&(s=null);return id$2=s,null}function jd(s){switch(s){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(ec()){case fc:return 1;case gc:return 4;case hc:case ic:return 16;case jc:return 536870912;default:return 16}default:return 16}}var kd=null,ld=null,md=null;function nd(){if(md)return md;var s,e=ld,a=e.length,o,c="value"in kd?kd.value:kd.textContent,d=c.length;for(s=0;s<a&&e[s]===c[s];s++);var g=a-s;for(o=1;o<=g&&e[a-o]===c[d-o];o++);return md=c.slice(s,1<o?1-o:void 0)}function od(s){var e=s.keyCode;return"charCode"in s?(s=s.charCode,s===0&&e===13&&(s=13)):s=e,s===10&&(s=13),32<=s||s===13?s:0}function pd(){return!0}function qd(){return!1}function rd(s){function e(a,o,c,d,g){this._reactName=a,this._targetInst=c,this.type=o,this.nativeEvent=d,this.target=g,this.currentTarget=null;for(var _ in s)s.hasOwnProperty(_)&&(a=s[_],this[_]=a?a(d):d[_]);return this.isDefaultPrevented=(d.defaultPrevented!=null?d.defaultPrevented:d.returnValue===!1)?pd:qd,this.isPropagationStopped=qd,this}return A(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var a=this.nativeEvent;a&&(a.preventDefault?a.preventDefault():typeof a.returnValue!="unknown"&&(a.returnValue=!1),this.isDefaultPrevented=pd)},stopPropagation:function(){var a=this.nativeEvent;a&&(a.stopPropagation?a.stopPropagation():typeof a.cancelBubble!="unknown"&&(a.cancelBubble=!0),this.isPropagationStopped=pd)},persist:function(){},isPersistent:pd}),e}var sd={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(s){return s.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},td=rd(sd),ud=A({},sd,{view:0,detail:0}),vd=rd(ud),wd,xd,yd,Ad=A({},ud,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:zd,button:0,buttons:0,relatedTarget:function(s){return s.relatedTarget===void 0?s.fromElement===s.srcElement?s.toElement:s.fromElement:s.relatedTarget},movementX:function(s){return"movementX"in s?s.movementX:(s!==yd&&(yd&&s.type==="mousemove"?(wd=s.screenX-yd.screenX,xd=s.screenY-yd.screenY):xd=wd=0,yd=s),wd)},movementY:function(s){return"movementY"in s?s.movementY:xd}}),Bd=rd(Ad),Cd=A({},Ad,{dataTransfer:0}),Dd=rd(Cd),Ed=A({},ud,{relatedTarget:0}),Fd=rd(Ed),Gd=A({},sd,{animationName:0,elapsedTime:0,pseudoElement:0}),Hd=rd(Gd),Id=A({},sd,{clipboardData:function(s){return"clipboardData"in s?s.clipboardData:window.clipboardData}}),Jd=rd(Id),Kd=A({},sd,{data:0}),Ld=rd(Kd),Md={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},Nd={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},Od={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function Pd(s){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(s):(s=Od[s])?!!e[s]:!1}function zd(){return Pd}var Qd=A({},ud,{key:function(s){if(s.key){var e=Md[s.key]||s.key;if(e!=="Unidentified")return e}return s.type==="keypress"?(s=od(s),s===13?"Enter":String.fromCharCode(s)):s.type==="keydown"||s.type==="keyup"?Nd[s.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:zd,charCode:function(s){return s.type==="keypress"?od(s):0},keyCode:function(s){return s.type==="keydown"||s.type==="keyup"?s.keyCode:0},which:function(s){return s.type==="keypress"?od(s):s.type==="keydown"||s.type==="keyup"?s.keyCode:0}}),Rd=rd(Qd),Sd=A({},Ad,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),Td=rd(Sd),Ud=A({},ud,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:zd}),Vd=rd(Ud),Wd=A({},sd,{propertyName:0,elapsedTime:0,pseudoElement:0}),Xd=rd(Wd),Yd=A({},Ad,{deltaX:function(s){return"deltaX"in s?s.deltaX:"wheelDeltaX"in s?-s.wheelDeltaX:0},deltaY:function(s){return"deltaY"in s?s.deltaY:"wheelDeltaY"in s?-s.wheelDeltaY:"wheelDelta"in s?-s.wheelDelta:0},deltaZ:0,deltaMode:0}),Zd=rd(Yd),$d=[9,13,27,32],ae=ia&&"CompositionEvent"in window,be=null;ia&&"documentMode"in document&&(be=document.documentMode);var ce=ia&&"TextEvent"in window&&!be,de=ia&&(!ae||be&&8<be&&11>=be),ee=" ",fe=!1;function ge(s,e){switch(s){case"keyup":return $d.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function he(s){return s=s.detail,typeof s=="object"&&"data"in s?s.data:null}var ie=!1;function je(s,e){switch(s){case"compositionend":return he(e);case"keypress":return e.which!==32?null:(fe=!0,ee);case"textInput":return s=e.data,s===ee&&fe?null:s;default:return null}}function ke(s,e){if(ie)return s==="compositionend"||!ae&&ge(s,e)?(s=nd(),md=ld=kd=null,ie=!1,s):null;switch(s){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return de&&e.locale!=="ko"?null:e.data;default:return null}}var le={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function me(s){var e=s&&s.nodeName&&s.nodeName.toLowerCase();return e==="input"?!!le[s.type]:e==="textarea"}function ne(s,e,a,o){Eb(o),e=oe(e,"onChange"),0<e.length&&(a=new td("onChange","change",null,a,o),s.push({event:a,listeners:e}))}var pe=null,qe=null;function re(s){se(s,0)}function te(s){var e=ue(s);if(Wa(e))return s}function ve(s,e){if(s==="change")return e}var we=!1;if(ia){var xe;if(ia){var ye="oninput"in document;if(!ye){var ze=document.createElement("div");ze.setAttribute("oninput","return;"),ye=typeof ze.oninput=="function"}xe=ye}else xe=!1;we=xe&&(!document.documentMode||9<document.documentMode)}function Ae(){pe&&(pe.detachEvent("onpropertychange",Be),qe=pe=null)}function Be(s){if(s.propertyName==="value"&&te(qe)){var e=[];ne(e,qe,s,xb(s)),Jb(re,e)}}function Ce(s,e,a){s==="focusin"?(Ae(),pe=e,qe=a,pe.attachEvent("onpropertychange",Be)):s==="focusout"&&Ae()}function De(s){if(s==="selectionchange"||s==="keyup"||s==="keydown")return te(qe)}function Ee(s,e){if(s==="click")return te(e)}function Fe(s,e){if(s==="input"||s==="change")return te(e)}function Ge(s,e){return s===e&&(s!==0||1/s===1/e)||s!==s&&e!==e}var He=typeof Object.is=="function"?Object.is:Ge;function Ie(s,e){if(He(s,e))return!0;if(typeof s!="object"||s===null||typeof e!="object"||e===null)return!1;var a=Object.keys(s),o=Object.keys(e);if(a.length!==o.length)return!1;for(o=0;o<a.length;o++){var c=a[o];if(!ja.call(e,c)||!He(s[c],e[c]))return!1}return!0}function Je(s){for(;s&&s.firstChild;)s=s.firstChild;return s}function Ke(s,e){var a=Je(s);s=0;for(var o;a;){if(a.nodeType===3){if(o=s+a.textContent.length,s<=e&&o>=e)return{node:a,offset:e-s};s=o}e:{for(;a;){if(a.nextSibling){a=a.nextSibling;break e}a=a.parentNode}a=void 0}a=Je(a)}}function Le(s,e){return s&&e?s===e?!0:s&&s.nodeType===3?!1:e&&e.nodeType===3?Le(s,e.parentNode):"contains"in s?s.contains(e):s.compareDocumentPosition?!!(s.compareDocumentPosition(e)&16):!1:!1}function Me(){for(var s=window,e=Xa();e instanceof s.HTMLIFrameElement;){try{var a=typeof e.contentWindow.location.href=="string"}catch{a=!1}if(a)s=e.contentWindow;else break;e=Xa(s.document)}return e}function Ne(s){var e=s&&s.nodeName&&s.nodeName.toLowerCase();return e&&(e==="input"&&(s.type==="text"||s.type==="search"||s.type==="tel"||s.type==="url"||s.type==="password")||e==="textarea"||s.contentEditable==="true")}function Oe(s){var e=Me(),a=s.focusedElem,o=s.selectionRange;if(e!==a&&a&&a.ownerDocument&&Le(a.ownerDocument.documentElement,a)){if(o!==null&&Ne(a)){if(e=o.start,s=o.end,s===void 0&&(s=e),"selectionStart"in a)a.selectionStart=e,a.selectionEnd=Math.min(s,a.value.length);else if(s=(e=a.ownerDocument||document)&&e.defaultView||window,s.getSelection){s=s.getSelection();var c=a.textContent.length,d=Math.min(o.start,c);o=o.end===void 0?d:Math.min(o.end,c),!s.extend&&d>o&&(c=o,o=d,d=c),c=Ke(a,d);var g=Ke(a,o);c&&g&&(s.rangeCount!==1||s.anchorNode!==c.node||s.anchorOffset!==c.offset||s.focusNode!==g.node||s.focusOffset!==g.offset)&&(e=e.createRange(),e.setStart(c.node,c.offset),s.removeAllRanges(),d>o?(s.addRange(e),s.extend(g.node,g.offset)):(e.setEnd(g.node,g.offset),s.addRange(e)))}}for(e=[],s=a;s=s.parentNode;)s.nodeType===1&&e.push({element:s,left:s.scrollLeft,top:s.scrollTop});for(typeof a.focus=="function"&&a.focus(),a=0;a<e.length;a++)s=e[a],s.element.scrollLeft=s.left,s.element.scrollTop=s.top}}var Pe=ia&&"documentMode"in document&&11>=document.documentMode,Qe=null,Re=null,Se=null,Te=!1;function Ue(s,e,a){var o=a.window===a?a.document:a.nodeType===9?a:a.ownerDocument;Te||Qe==null||Qe!==Xa(o)||(o=Qe,"selectionStart"in o&&Ne(o)?o={start:o.selectionStart,end:o.selectionEnd}:(o=(o.ownerDocument&&o.ownerDocument.defaultView||window).getSelection(),o={anchorNode:o.anchorNode,anchorOffset:o.anchorOffset,focusNode:o.focusNode,focusOffset:o.focusOffset}),Se&&Ie(Se,o)||(Se=o,o=oe(Re,"onSelect"),0<o.length&&(e=new td("onSelect","select",null,e,a),s.push({event:e,listeners:o}),e.target=Qe)))}function Ve(s,e){var a={};return a[s.toLowerCase()]=e.toLowerCase(),a["Webkit"+s]="webkit"+e,a["Moz"+s]="moz"+e,a}var We={animationend:Ve("Animation","AnimationEnd"),animationiteration:Ve("Animation","AnimationIteration"),animationstart:Ve("Animation","AnimationStart"),transitionend:Ve("Transition","TransitionEnd")},Xe={},Ye={};ia&&(Ye=document.createElement("div").style,"AnimationEvent"in window||(delete We.animationend.animation,delete We.animationiteration.animation,delete We.animationstart.animation),"TransitionEvent"in window||delete We.transitionend.transition);function Ze(s){if(Xe[s])return Xe[s];if(!We[s])return s;var e=We[s],a;for(a in e)if(e.hasOwnProperty(a)&&a in Ye)return Xe[s]=e[a];return s}var $e=Ze("animationend"),af=Ze("animationiteration"),bf=Ze("animationstart"),cf=Ze("transitionend"),df=new Map,ef="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function ff(s,e){df.set(s,e),fa(e,[s])}for(var gf=0;gf<ef.length;gf++){var hf=ef[gf],jf=hf.toLowerCase(),kf=hf[0].toUpperCase()+hf.slice(1);ff(jf,"on"+kf)}ff($e,"onAnimationEnd");ff(af,"onAnimationIteration");ff(bf,"onAnimationStart");ff("dblclick","onDoubleClick");ff("focusin","onFocus");ff("focusout","onBlur");ff(cf,"onTransitionEnd");ha("onMouseEnter",["mouseout","mouseover"]);ha("onMouseLeave",["mouseout","mouseover"]);ha("onPointerEnter",["pointerout","pointerover"]);ha("onPointerLeave",["pointerout","pointerover"]);fa("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));fa("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));fa("onBeforeInput",["compositionend","keypress","textInput","paste"]);fa("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));fa("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));fa("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var lf="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),mf=new Set("cancel close invalid load scroll toggle".split(" ").concat(lf));function nf(s,e,a){var o=s.type||"unknown-event";s.currentTarget=a,Ub(o,e,void 0,s),s.currentTarget=null}function se(s,e){e=(e&4)!==0;for(var a=0;a<s.length;a++){var o=s[a],c=o.event;o=o.listeners;e:{var d=void 0;if(e)for(var g=o.length-1;0<=g;g--){var _=o[g],b=_.instance,$=_.currentTarget;if(_=_.listener,b!==d&&c.isPropagationStopped())break e;nf(c,_,$),d=b}else for(g=0;g<o.length;g++){if(_=o[g],b=_.instance,$=_.currentTarget,_=_.listener,b!==d&&c.isPropagationStopped())break e;nf(c,_,$),d=b}}}if(Qb)throw s=Rb,Qb=!1,Rb=null,s}function D(s,e){var a=e[of];a===void 0&&(a=e[of]=new Set);var o=s+"__bubble";a.has(o)||(pf(e,s,2,!1),a.add(o))}function qf(s,e,a){var o=0;e&&(o|=4),pf(a,s,o,e)}var rf="_reactListening"+Math.random().toString(36).slice(2);function sf(s){if(!s[rf]){s[rf]=!0,da.forEach(function(a){a!=="selectionchange"&&(mf.has(a)||qf(a,!1,s),qf(a,!0,s))});var e=s.nodeType===9?s:s.ownerDocument;e===null||e[rf]||(e[rf]=!0,qf("selectionchange",!1,e))}}function pf(s,e,a,o){switch(jd(e)){case 1:var c=ed;break;case 4:c=gd;break;default:c=fd}a=c.bind(null,e,a,s),c=void 0,!Lb||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(c=!0),o?c!==void 0?s.addEventListener(e,a,{capture:!0,passive:c}):s.addEventListener(e,a,!0):c!==void 0?s.addEventListener(e,a,{passive:c}):s.addEventListener(e,a,!1)}function hd(s,e,a,o,c){var d=o;if(!(e&1)&&!(e&2)&&o!==null)e:for(;;){if(o===null)return;var g=o.tag;if(g===3||g===4){var _=o.stateNode.containerInfo;if(_===c||_.nodeType===8&&_.parentNode===c)break;if(g===4)for(g=o.return;g!==null;){var b=g.tag;if((b===3||b===4)&&(b=g.stateNode.containerInfo,b===c||b.nodeType===8&&b.parentNode===c))return;g=g.return}for(;_!==null;){if(g=Wc(_),g===null)return;if(b=g.tag,b===5||b===6){o=d=g;continue e}_=_.parentNode}}o=o.return}Jb(function(){var $=d,tt=xb(a),rt=[];e:{var et=df.get(s);if(et!==void 0){var st=td,ot=s;switch(s){case"keypress":if(od(a)===0)break e;case"keydown":case"keyup":st=Rd;break;case"focusin":ot="focus",st=Fd;break;case"focusout":ot="blur",st=Fd;break;case"beforeblur":case"afterblur":st=Fd;break;case"click":if(a.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":st=Bd;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":st=Dd;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":st=Vd;break;case $e:case af:case bf:st=Hd;break;case cf:st=Xd;break;case"scroll":st=vd;break;case"wheel":st=Zd;break;case"copy":case"cut":case"paste":st=Jd;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":st=Td}var at=(e&4)!==0,lt=!at&&s==="scroll",_e=at?et!==null?et+"Capture":null:et;at=[];for(var it=$,nt;it!==null;){nt=it;var ct=nt.stateNode;if(nt.tag===5&&ct!==null&&(nt=ct,_e!==null&&(ct=Kb(it,_e),ct!=null&&at.push(tf(it,ct,nt)))),lt)break;it=it.return}0<at.length&&(et=new st(et,ot,null,a,tt),rt.push({event:et,listeners:at}))}}if(!(e&7)){e:{if(et=s==="mouseover"||s==="pointerover",st=s==="mouseout"||s==="pointerout",et&&a!==wb&&(ot=a.relatedTarget||a.fromElement)&&(Wc(ot)||ot[uf]))break e;if((st||et)&&(et=tt.window===tt?tt:(et=tt.ownerDocument)?et.defaultView||et.parentWindow:window,st?(ot=a.relatedTarget||a.toElement,st=$,ot=ot?Wc(ot):null,ot!==null&&(lt=Vb(ot),ot!==lt||ot.tag!==5&&ot.tag!==6)&&(ot=null)):(st=null,ot=$),st!==ot)){if(at=Bd,ct="onMouseLeave",_e="onMouseEnter",it="mouse",(s==="pointerout"||s==="pointerover")&&(at=Td,ct="onPointerLeave",_e="onPointerEnter",it="pointer"),lt=st==null?et:ue(st),nt=ot==null?et:ue(ot),et=new at(ct,it+"leave",st,a,tt),et.target=lt,et.relatedTarget=nt,ct=null,Wc(tt)===$&&(at=new at(_e,it+"enter",ot,a,tt),at.target=nt,at.relatedTarget=lt,ct=at),lt=ct,st&&ot)t:{for(at=st,_e=ot,it=0,nt=at;nt;nt=vf(nt))it++;for(nt=0,ct=_e;ct;ct=vf(ct))nt++;for(;0<it-nt;)at=vf(at),it--;for(;0<nt-it;)_e=vf(_e),nt--;for(;it--;){if(at===_e||_e!==null&&at===_e.alternate)break t;at=vf(at),_e=vf(_e)}at=null}else at=null;st!==null&&wf(rt,et,st,at,!1),ot!==null&&lt!==null&&wf(rt,lt,ot,at,!0)}}e:{if(et=$?ue($):window,st=et.nodeName&&et.nodeName.toLowerCase(),st==="select"||st==="input"&&et.type==="file")var ht=ve;else if(me(et))if(we)ht=Fe;else{ht=De;var ft=Ce}else(st=et.nodeName)&&st.toLowerCase()==="input"&&(et.type==="checkbox"||et.type==="radio")&&(ht=Ee);if(ht&&(ht=ht(s,$))){ne(rt,ht,a,tt);break e}ft&&ft(s,et,$),s==="focusout"&&(ft=et._wrapperState)&&ft.controlled&&et.type==="number"&&cb(et,"number",et.value)}switch(ft=$?ue($):window,s){case"focusin":(me(ft)||ft.contentEditable==="true")&&(Qe=ft,Re=$,Se=null);break;case"focusout":Se=Re=Qe=null;break;case"mousedown":Te=!0;break;case"contextmenu":case"mouseup":case"dragend":Te=!1,Ue(rt,a,tt);break;case"selectionchange":if(Pe)break;case"keydown":case"keyup":Ue(rt,a,tt)}var pt;if(ae)e:{switch(s){case"compositionstart":var yt="onCompositionStart";break e;case"compositionend":yt="onCompositionEnd";break e;case"compositionupdate":yt="onCompositionUpdate";break e}yt=void 0}else ie?ge(s,a)&&(yt="onCompositionEnd"):s==="keydown"&&a.keyCode===229&&(yt="onCompositionStart");yt&&(de&&a.locale!=="ko"&&(ie||yt!=="onCompositionStart"?yt==="onCompositionEnd"&&ie&&(pt=nd()):(kd=tt,ld="value"in kd?kd.value:kd.textContent,ie=!0)),ft=oe($,yt),0<ft.length&&(yt=new Ld(yt,s,null,a,tt),rt.push({event:yt,listeners:ft}),pt?yt.data=pt:(pt=he(a),pt!==null&&(yt.data=pt)))),(pt=ce?je(s,a):ke(s,a))&&($=oe($,"onBeforeInput"),0<$.length&&(tt=new Ld("onBeforeInput","beforeinput",null,a,tt),rt.push({event:tt,listeners:$}),tt.data=pt))}se(rt,e)})}function tf(s,e,a){return{instance:s,listener:e,currentTarget:a}}function oe(s,e){for(var a=e+"Capture",o=[];s!==null;){var c=s,d=c.stateNode;c.tag===5&&d!==null&&(c=d,d=Kb(s,a),d!=null&&o.unshift(tf(s,d,c)),d=Kb(s,e),d!=null&&o.push(tf(s,d,c))),s=s.return}return o}function vf(s){if(s===null)return null;do s=s.return;while(s&&s.tag!==5);return s||null}function wf(s,e,a,o,c){for(var d=e._reactName,g=[];a!==null&&a!==o;){var _=a,b=_.alternate,$=_.stateNode;if(b!==null&&b===o)break;_.tag===5&&$!==null&&(_=$,c?(b=Kb(a,d),b!=null&&g.unshift(tf(a,b,_))):c||(b=Kb(a,d),b!=null&&g.push(tf(a,b,_)))),a=a.return}g.length!==0&&s.push({event:e,listeners:g})}var xf=/\r\n?/g,yf=/\u0000|\uFFFD/g;function zf(s){return(typeof s=="string"?s:""+s).replace(xf,`
`).replace(yf,"")}function Af(s,e,a){if(e=zf(e),zf(s)!==e&&a)throw Error(p(425))}function Bf(){}var Cf=null,Df=null;function Ef(s,e){return s==="textarea"||s==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var Ff=typeof setTimeout=="function"?setTimeout:void 0,Gf=typeof clearTimeout=="function"?clearTimeout:void 0,Hf=typeof Promise=="function"?Promise:void 0,Jf=typeof queueMicrotask=="function"?queueMicrotask:typeof Hf<"u"?function(s){return Hf.resolve(null).then(s).catch(If)}:Ff;function If(s){setTimeout(function(){throw s})}function Kf(s,e){var a=e,o=0;do{var c=a.nextSibling;if(s.removeChild(a),c&&c.nodeType===8)if(a=c.data,a==="/$"){if(o===0){s.removeChild(c),bd(e);return}o--}else a!=="$"&&a!=="$?"&&a!=="$!"||o++;a=c}while(a);bd(e)}function Lf(s){for(;s!=null;s=s.nextSibling){var e=s.nodeType;if(e===1||e===3)break;if(e===8){if(e=s.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return s}function Mf(s){s=s.previousSibling;for(var e=0;s;){if(s.nodeType===8){var a=s.data;if(a==="$"||a==="$!"||a==="$?"){if(e===0)return s;e--}else a==="/$"&&e++}s=s.previousSibling}return null}var Nf=Math.random().toString(36).slice(2),Of="__reactFiber$"+Nf,Pf="__reactProps$"+Nf,uf="__reactContainer$"+Nf,of="__reactEvents$"+Nf,Qf="__reactListeners$"+Nf,Rf="__reactHandles$"+Nf;function Wc(s){var e=s[Of];if(e)return e;for(var a=s.parentNode;a;){if(e=a[uf]||a[Of]){if(a=e.alternate,e.child!==null||a!==null&&a.child!==null)for(s=Mf(s);s!==null;){if(a=s[Of])return a;s=Mf(s)}return e}s=a,a=s.parentNode}return null}function Cb(s){return s=s[Of]||s[uf],!s||s.tag!==5&&s.tag!==6&&s.tag!==13&&s.tag!==3?null:s}function ue(s){if(s.tag===5||s.tag===6)return s.stateNode;throw Error(p(33))}function Db(s){return s[Pf]||null}var Sf=[],Tf=-1;function Uf(s){return{current:s}}function E(s){0>Tf||(s.current=Sf[Tf],Sf[Tf]=null,Tf--)}function G(s,e){Tf++,Sf[Tf]=s.current,s.current=e}var Vf={},H=Uf(Vf),Wf=Uf(!1),Xf=Vf;function Yf(s,e){var a=s.type.contextTypes;if(!a)return Vf;var o=s.stateNode;if(o&&o.__reactInternalMemoizedUnmaskedChildContext===e)return o.__reactInternalMemoizedMaskedChildContext;var c={},d;for(d in a)c[d]=e[d];return o&&(s=s.stateNode,s.__reactInternalMemoizedUnmaskedChildContext=e,s.__reactInternalMemoizedMaskedChildContext=c),c}function Zf(s){return s=s.childContextTypes,s!=null}function $f(){E(Wf),E(H)}function ag(s,e,a){if(H.current!==Vf)throw Error(p(168));G(H,e),G(Wf,a)}function bg(s,e,a){var o=s.stateNode;if(e=e.childContextTypes,typeof o.getChildContext!="function")return a;o=o.getChildContext();for(var c in o)if(!(c in e))throw Error(p(108,Ra(s)||"Unknown",c));return A({},a,o)}function cg(s){return s=(s=s.stateNode)&&s.__reactInternalMemoizedMergedChildContext||Vf,Xf=H.current,G(H,s),G(Wf,Wf.current),!0}function dg(s,e,a){var o=s.stateNode;if(!o)throw Error(p(169));a?(s=bg(s,e,Xf),o.__reactInternalMemoizedMergedChildContext=s,E(Wf),E(H),G(H,s)):E(Wf),G(Wf,a)}var eg=null,fg=!1,gg=!1;function hg(s){eg===null?eg=[s]:eg.push(s)}function ig(s){fg=!0,hg(s)}function jg(){if(!gg&&eg!==null){gg=!0;var s=0,e=C;try{var a=eg;for(C=1;s<a.length;s++){var o=a[s];do o=o(!0);while(o!==null)}eg=null,fg=!1}catch(c){throw eg!==null&&(eg=eg.slice(s+1)),ac(fc,jg),c}finally{C=e,gg=!1}}return null}var kg=[],lg=0,mg=null,ng=0,og=[],pg=0,qg=null,rg=1,sg="";function tg(s,e){kg[lg++]=ng,kg[lg++]=mg,mg=s,ng=e}function ug(s,e,a){og[pg++]=rg,og[pg++]=sg,og[pg++]=qg,qg=s;var o=rg;s=sg;var c=32-oc(o)-1;o&=~(1<<c),a+=1;var d=32-oc(e)+c;if(30<d){var g=c-c%5;d=(o&(1<<g)-1).toString(32),o>>=g,c-=g,rg=1<<32-oc(e)+c|a<<c|o,sg=d+s}else rg=1<<d|a<<c|o,sg=s}function vg(s){s.return!==null&&(tg(s,1),ug(s,1,0))}function wg(s){for(;s===mg;)mg=kg[--lg],kg[lg]=null,ng=kg[--lg],kg[lg]=null;for(;s===qg;)qg=og[--pg],og[pg]=null,sg=og[--pg],og[pg]=null,rg=og[--pg],og[pg]=null}var xg=null,yg=null,I=!1,zg=null;function Ag(s,e){var a=Bg(5,null,null,0);a.elementType="DELETED",a.stateNode=e,a.return=s,e=s.deletions,e===null?(s.deletions=[a],s.flags|=16):e.push(a)}function Cg(s,e){switch(s.tag){case 5:var a=s.type;return e=e.nodeType!==1||a.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(s.stateNode=e,xg=s,yg=Lf(e.firstChild),!0):!1;case 6:return e=s.pendingProps===""||e.nodeType!==3?null:e,e!==null?(s.stateNode=e,xg=s,yg=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(a=qg!==null?{id:rg,overflow:sg}:null,s.memoizedState={dehydrated:e,treeContext:a,retryLane:1073741824},a=Bg(18,null,null,0),a.stateNode=e,a.return=s,s.child=a,xg=s,yg=null,!0):!1;default:return!1}}function Dg(s){return(s.mode&1)!==0&&(s.flags&128)===0}function Eg(s){if(I){var e=yg;if(e){var a=e;if(!Cg(s,e)){if(Dg(s))throw Error(p(418));e=Lf(a.nextSibling);var o=xg;e&&Cg(s,e)?Ag(o,a):(s.flags=s.flags&-4097|2,I=!1,xg=s)}}else{if(Dg(s))throw Error(p(418));s.flags=s.flags&-4097|2,I=!1,xg=s}}}function Fg(s){for(s=s.return;s!==null&&s.tag!==5&&s.tag!==3&&s.tag!==13;)s=s.return;xg=s}function Gg(s){if(s!==xg)return!1;if(!I)return Fg(s),I=!0,!1;var e;if((e=s.tag!==3)&&!(e=s.tag!==5)&&(e=s.type,e=e!=="head"&&e!=="body"&&!Ef(s.type,s.memoizedProps)),e&&(e=yg)){if(Dg(s))throw Hg(),Error(p(418));for(;e;)Ag(s,e),e=Lf(e.nextSibling)}if(Fg(s),s.tag===13){if(s=s.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(p(317));e:{for(s=s.nextSibling,e=0;s;){if(s.nodeType===8){var a=s.data;if(a==="/$"){if(e===0){yg=Lf(s.nextSibling);break e}e--}else a!=="$"&&a!=="$!"&&a!=="$?"||e++}s=s.nextSibling}yg=null}}else yg=xg?Lf(s.stateNode.nextSibling):null;return!0}function Hg(){for(var s=yg;s;)s=Lf(s.nextSibling)}function Ig(){yg=xg=null,I=!1}function Jg(s){zg===null?zg=[s]:zg.push(s)}var Kg=ua.ReactCurrentBatchConfig;function Lg(s,e){if(s&&s.defaultProps){e=A({},e),s=s.defaultProps;for(var a in s)e[a]===void 0&&(e[a]=s[a]);return e}return e}var Mg=Uf(null),Ng=null,Og=null,Pg=null;function Qg(){Pg=Og=Ng=null}function Rg(s){var e=Mg.current;E(Mg),s._currentValue=e}function Sg(s,e,a){for(;s!==null;){var o=s.alternate;if((s.childLanes&e)!==e?(s.childLanes|=e,o!==null&&(o.childLanes|=e)):o!==null&&(o.childLanes&e)!==e&&(o.childLanes|=e),s===a)break;s=s.return}}function Tg(s,e){Ng=s,Pg=Og=null,s=s.dependencies,s!==null&&s.firstContext!==null&&(s.lanes&e&&(Ug=!0),s.firstContext=null)}function Vg(s){var e=s._currentValue;if(Pg!==s)if(s={context:s,memoizedValue:e,next:null},Og===null){if(Ng===null)throw Error(p(308));Og=s,Ng.dependencies={lanes:0,firstContext:s}}else Og=Og.next=s;return e}var Wg=null;function Xg(s){Wg===null?Wg=[s]:Wg.push(s)}function Yg(s,e,a,o){var c=e.interleaved;return c===null?(a.next=a,Xg(e)):(a.next=c.next,c.next=a),e.interleaved=a,Zg(s,o)}function Zg(s,e){s.lanes|=e;var a=s.alternate;for(a!==null&&(a.lanes|=e),a=s,s=s.return;s!==null;)s.childLanes|=e,a=s.alternate,a!==null&&(a.childLanes|=e),a=s,s=s.return;return a.tag===3?a.stateNode:null}var $g=!1;function ah(s){s.updateQueue={baseState:s.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function bh(s,e){s=s.updateQueue,e.updateQueue===s&&(e.updateQueue={baseState:s.baseState,firstBaseUpdate:s.firstBaseUpdate,lastBaseUpdate:s.lastBaseUpdate,shared:s.shared,effects:s.effects})}function ch(s,e){return{eventTime:s,lane:e,tag:0,payload:null,callback:null,next:null}}function dh(s,e,a){var o=s.updateQueue;if(o===null)return null;if(o=o.shared,K&2){var c=o.pending;return c===null?e.next=e:(e.next=c.next,c.next=e),o.pending=e,Zg(s,a)}return c=o.interleaved,c===null?(e.next=e,Xg(o)):(e.next=c.next,c.next=e),o.interleaved=e,Zg(s,a)}function eh(s,e,a){if(e=e.updateQueue,e!==null&&(e=e.shared,(a&4194240)!==0)){var o=e.lanes;o&=s.pendingLanes,a|=o,e.lanes=a,Cc(s,a)}}function fh(s,e){var a=s.updateQueue,o=s.alternate;if(o!==null&&(o=o.updateQueue,a===o)){var c=null,d=null;if(a=a.firstBaseUpdate,a!==null){do{var g={eventTime:a.eventTime,lane:a.lane,tag:a.tag,payload:a.payload,callback:a.callback,next:null};d===null?c=d=g:d=d.next=g,a=a.next}while(a!==null);d===null?c=d=e:d=d.next=e}else c=d=e;a={baseState:o.baseState,firstBaseUpdate:c,lastBaseUpdate:d,shared:o.shared,effects:o.effects},s.updateQueue=a;return}s=a.lastBaseUpdate,s===null?a.firstBaseUpdate=e:s.next=e,a.lastBaseUpdate=e}function gh(s,e,a,o){var c=s.updateQueue;$g=!1;var d=c.firstBaseUpdate,g=c.lastBaseUpdate,_=c.shared.pending;if(_!==null){c.shared.pending=null;var b=_,$=b.next;b.next=null,g===null?d=$:g.next=$,g=b;var tt=s.alternate;tt!==null&&(tt=tt.updateQueue,_=tt.lastBaseUpdate,_!==g&&(_===null?tt.firstBaseUpdate=$:_.next=$,tt.lastBaseUpdate=b))}if(d!==null){var rt=c.baseState;g=0,tt=$=b=null,_=d;do{var et=_.lane,st=_.eventTime;if((o&et)===et){tt!==null&&(tt=tt.next={eventTime:st,lane:0,tag:_.tag,payload:_.payload,callback:_.callback,next:null});e:{var ot=s,at=_;switch(et=e,st=a,at.tag){case 1:if(ot=at.payload,typeof ot=="function"){rt=ot.call(st,rt,et);break e}rt=ot;break e;case 3:ot.flags=ot.flags&-65537|128;case 0:if(ot=at.payload,et=typeof ot=="function"?ot.call(st,rt,et):ot,et==null)break e;rt=A({},rt,et);break e;case 2:$g=!0}}_.callback!==null&&_.lane!==0&&(s.flags|=64,et=c.effects,et===null?c.effects=[_]:et.push(_))}else st={eventTime:st,lane:et,tag:_.tag,payload:_.payload,callback:_.callback,next:null},tt===null?($=tt=st,b=rt):tt=tt.next=st,g|=et;if(_=_.next,_===null){if(_=c.shared.pending,_===null)break;et=_,_=et.next,et.next=null,c.lastBaseUpdate=et,c.shared.pending=null}}while(!0);if(tt===null&&(b=rt),c.baseState=b,c.firstBaseUpdate=$,c.lastBaseUpdate=tt,e=c.shared.interleaved,e!==null){c=e;do g|=c.lane,c=c.next;while(c!==e)}else d===null&&(c.shared.lanes=0);hh|=g,s.lanes=g,s.memoizedState=rt}}function ih(s,e,a){if(s=e.effects,e.effects=null,s!==null)for(e=0;e<s.length;e++){var o=s[e],c=o.callback;if(c!==null){if(o.callback=null,o=a,typeof c!="function")throw Error(p(191,c));c.call(o)}}}var jh=new aa.Component().refs;function kh(s,e,a,o){e=s.memoizedState,a=a(o,e),a=a==null?e:A({},e,a),s.memoizedState=a,s.lanes===0&&(s.updateQueue.baseState=a)}var nh={isMounted:function(s){return(s=s._reactInternals)?Vb(s)===s:!1},enqueueSetState:function(s,e,a){s=s._reactInternals;var o=L(),c=lh(s),d=ch(o,c);d.payload=e,a!=null&&(d.callback=a),e=dh(s,d,c),e!==null&&(mh(e,s,c,o),eh(e,s,c))},enqueueReplaceState:function(s,e,a){s=s._reactInternals;var o=L(),c=lh(s),d=ch(o,c);d.tag=1,d.payload=e,a!=null&&(d.callback=a),e=dh(s,d,c),e!==null&&(mh(e,s,c,o),eh(e,s,c))},enqueueForceUpdate:function(s,e){s=s._reactInternals;var a=L(),o=lh(s),c=ch(a,o);c.tag=2,e!=null&&(c.callback=e),e=dh(s,c,o),e!==null&&(mh(e,s,o,a),eh(e,s,o))}};function oh(s,e,a,o,c,d,g){return s=s.stateNode,typeof s.shouldComponentUpdate=="function"?s.shouldComponentUpdate(o,d,g):e.prototype&&e.prototype.isPureReactComponent?!Ie(a,o)||!Ie(c,d):!0}function ph(s,e,a){var o=!1,c=Vf,d=e.contextType;return typeof d=="object"&&d!==null?d=Vg(d):(c=Zf(e)?Xf:H.current,o=e.contextTypes,d=(o=o!=null)?Yf(s,c):Vf),e=new e(a,d),s.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=nh,s.stateNode=e,e._reactInternals=s,o&&(s=s.stateNode,s.__reactInternalMemoizedUnmaskedChildContext=c,s.__reactInternalMemoizedMaskedChildContext=d),e}function qh(s,e,a,o){s=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(a,o),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(a,o),e.state!==s&&nh.enqueueReplaceState(e,e.state,null)}function rh(s,e,a,o){var c=s.stateNode;c.props=a,c.state=s.memoizedState,c.refs=jh,ah(s);var d=e.contextType;typeof d=="object"&&d!==null?c.context=Vg(d):(d=Zf(e)?Xf:H.current,c.context=Yf(s,d)),c.state=s.memoizedState,d=e.getDerivedStateFromProps,typeof d=="function"&&(kh(s,e,d,a),c.state=s.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof c.getSnapshotBeforeUpdate=="function"||typeof c.UNSAFE_componentWillMount!="function"&&typeof c.componentWillMount!="function"||(e=c.state,typeof c.componentWillMount=="function"&&c.componentWillMount(),typeof c.UNSAFE_componentWillMount=="function"&&c.UNSAFE_componentWillMount(),e!==c.state&&nh.enqueueReplaceState(c,c.state,null),gh(s,a,c,o),c.state=s.memoizedState),typeof c.componentDidMount=="function"&&(s.flags|=4194308)}function sh(s,e,a){if(s=a.ref,s!==null&&typeof s!="function"&&typeof s!="object"){if(a._owner){if(a=a._owner,a){if(a.tag!==1)throw Error(p(309));var o=a.stateNode}if(!o)throw Error(p(147,s));var c=o,d=""+s;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===d?e.ref:(e=function(g){var _=c.refs;_===jh&&(_=c.refs={}),g===null?delete _[d]:_[d]=g},e._stringRef=d,e)}if(typeof s!="string")throw Error(p(284));if(!a._owner)throw Error(p(290,s))}return s}function th(s,e){throw s=Object.prototype.toString.call(e),Error(p(31,s==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":s))}function uh(s){var e=s._init;return e(s._payload)}function vh(s){function e(_e,it){if(s){var nt=_e.deletions;nt===null?(_e.deletions=[it],_e.flags|=16):nt.push(it)}}function a(_e,it){if(!s)return null;for(;it!==null;)e(_e,it),it=it.sibling;return null}function o(_e,it){for(_e=new Map;it!==null;)it.key!==null?_e.set(it.key,it):_e.set(it.index,it),it=it.sibling;return _e}function c(_e,it){return _e=wh(_e,it),_e.index=0,_e.sibling=null,_e}function d(_e,it,nt){return _e.index=nt,s?(nt=_e.alternate,nt!==null?(nt=nt.index,nt<it?(_e.flags|=2,it):nt):(_e.flags|=2,it)):(_e.flags|=1048576,it)}function g(_e){return s&&_e.alternate===null&&(_e.flags|=2),_e}function _(_e,it,nt,ct){return it===null||it.tag!==6?(it=xh(nt,_e.mode,ct),it.return=_e,it):(it=c(it,nt),it.return=_e,it)}function b(_e,it,nt,ct){var ht=nt.type;return ht===ya?tt(_e,it,nt.props.children,ct,nt.key):it!==null&&(it.elementType===ht||typeof ht=="object"&&ht!==null&&ht.$$typeof===Ha&&uh(ht)===it.type)?(ct=c(it,nt.props),ct.ref=sh(_e,it,nt),ct.return=_e,ct):(ct=yh(nt.type,nt.key,nt.props,null,_e.mode,ct),ct.ref=sh(_e,it,nt),ct.return=_e,ct)}function $(_e,it,nt,ct){return it===null||it.tag!==4||it.stateNode.containerInfo!==nt.containerInfo||it.stateNode.implementation!==nt.implementation?(it=zh(nt,_e.mode,ct),it.return=_e,it):(it=c(it,nt.children||[]),it.return=_e,it)}function tt(_e,it,nt,ct,ht){return it===null||it.tag!==7?(it=Ah(nt,_e.mode,ct,ht),it.return=_e,it):(it=c(it,nt),it.return=_e,it)}function rt(_e,it,nt){if(typeof it=="string"&&it!==""||typeof it=="number")return it=xh(""+it,_e.mode,nt),it.return=_e,it;if(typeof it=="object"&&it!==null){switch(it.$$typeof){case va:return nt=yh(it.type,it.key,it.props,null,_e.mode,nt),nt.ref=sh(_e,null,it),nt.return=_e,nt;case wa:return it=zh(it,_e.mode,nt),it.return=_e,it;case Ha:var ct=it._init;return rt(_e,ct(it._payload),nt)}if(eb(it)||Ka(it))return it=Ah(it,_e.mode,nt,null),it.return=_e,it;th(_e,it)}return null}function et(_e,it,nt,ct){var ht=it!==null?it.key:null;if(typeof nt=="string"&&nt!==""||typeof nt=="number")return ht!==null?null:_(_e,it,""+nt,ct);if(typeof nt=="object"&&nt!==null){switch(nt.$$typeof){case va:return nt.key===ht?b(_e,it,nt,ct):null;case wa:return nt.key===ht?$(_e,it,nt,ct):null;case Ha:return ht=nt._init,et(_e,it,ht(nt._payload),ct)}if(eb(nt)||Ka(nt))return ht!==null?null:tt(_e,it,nt,ct,null);th(_e,nt)}return null}function st(_e,it,nt,ct,ht){if(typeof ct=="string"&&ct!==""||typeof ct=="number")return _e=_e.get(nt)||null,_(it,_e,""+ct,ht);if(typeof ct=="object"&&ct!==null){switch(ct.$$typeof){case va:return _e=_e.get(ct.key===null?nt:ct.key)||null,b(it,_e,ct,ht);case wa:return _e=_e.get(ct.key===null?nt:ct.key)||null,$(it,_e,ct,ht);case Ha:var ft=ct._init;return st(_e,it,nt,ft(ct._payload),ht)}if(eb(ct)||Ka(ct))return _e=_e.get(nt)||null,tt(it,_e,ct,ht,null);th(it,ct)}return null}function ot(_e,it,nt,ct){for(var ht=null,ft=null,pt=it,yt=it=0,vt=null;pt!==null&&yt<nt.length;yt++){pt.index>yt?(vt=pt,pt=null):vt=pt.sibling;var gt=et(_e,pt,nt[yt],ct);if(gt===null){pt===null&&(pt=vt);break}s&&pt&&gt.alternate===null&&e(_e,pt),it=d(gt,it,yt),ft===null?ht=gt:ft.sibling=gt,ft=gt,pt=vt}if(yt===nt.length)return a(_e,pt),I&&tg(_e,yt),ht;if(pt===null){for(;yt<nt.length;yt++)pt=rt(_e,nt[yt],ct),pt!==null&&(it=d(pt,it,yt),ft===null?ht=pt:ft.sibling=pt,ft=pt);return I&&tg(_e,yt),ht}for(pt=o(_e,pt);yt<nt.length;yt++)vt=st(pt,_e,yt,nt[yt],ct),vt!==null&&(s&&vt.alternate!==null&&pt.delete(vt.key===null?yt:vt.key),it=d(vt,it,yt),ft===null?ht=vt:ft.sibling=vt,ft=vt);return s&&pt.forEach(function(Ct){return e(_e,Ct)}),I&&tg(_e,yt),ht}function at(_e,it,nt,ct){var ht=Ka(nt);if(typeof ht!="function")throw Error(p(150));if(nt=ht.call(nt),nt==null)throw Error(p(151));for(var ft=ht=null,pt=it,yt=it=0,vt=null,gt=nt.next();pt!==null&&!gt.done;yt++,gt=nt.next()){pt.index>yt?(vt=pt,pt=null):vt=pt.sibling;var Ct=et(_e,pt,gt.value,ct);if(Ct===null){pt===null&&(pt=vt);break}s&&pt&&Ct.alternate===null&&e(_e,pt),it=d(Ct,it,yt),ft===null?ht=Ct:ft.sibling=Ct,ft=Ct,pt=vt}if(gt.done)return a(_e,pt),I&&tg(_e,yt),ht;if(pt===null){for(;!gt.done;yt++,gt=nt.next())gt=rt(_e,gt.value,ct),gt!==null&&(it=d(gt,it,yt),ft===null?ht=gt:ft.sibling=gt,ft=gt);return I&&tg(_e,yt),ht}for(pt=o(_e,pt);!gt.done;yt++,gt=nt.next())gt=st(pt,_e,yt,gt.value,ct),gt!==null&&(s&&gt.alternate!==null&&pt.delete(gt.key===null?yt:gt.key),it=d(gt,it,yt),ft===null?ht=gt:ft.sibling=gt,ft=gt);return s&&pt.forEach(function(Pt){return e(_e,Pt)}),I&&tg(_e,yt),ht}function lt(_e,it,nt,ct){if(typeof nt=="object"&&nt!==null&&nt.type===ya&&nt.key===null&&(nt=nt.props.children),typeof nt=="object"&&nt!==null){switch(nt.$$typeof){case va:e:{for(var ht=nt.key,ft=it;ft!==null;){if(ft.key===ht){if(ht=nt.type,ht===ya){if(ft.tag===7){a(_e,ft.sibling),it=c(ft,nt.props.children),it.return=_e,_e=it;break e}}else if(ft.elementType===ht||typeof ht=="object"&&ht!==null&&ht.$$typeof===Ha&&uh(ht)===ft.type){a(_e,ft.sibling),it=c(ft,nt.props),it.ref=sh(_e,ft,nt),it.return=_e,_e=it;break e}a(_e,ft);break}else e(_e,ft);ft=ft.sibling}nt.type===ya?(it=Ah(nt.props.children,_e.mode,ct,nt.key),it.return=_e,_e=it):(ct=yh(nt.type,nt.key,nt.props,null,_e.mode,ct),ct.ref=sh(_e,it,nt),ct.return=_e,_e=ct)}return g(_e);case wa:e:{for(ft=nt.key;it!==null;){if(it.key===ft)if(it.tag===4&&it.stateNode.containerInfo===nt.containerInfo&&it.stateNode.implementation===nt.implementation){a(_e,it.sibling),it=c(it,nt.children||[]),it.return=_e,_e=it;break e}else{a(_e,it);break}else e(_e,it);it=it.sibling}it=zh(nt,_e.mode,ct),it.return=_e,_e=it}return g(_e);case Ha:return ft=nt._init,lt(_e,it,ft(nt._payload),ct)}if(eb(nt))return ot(_e,it,nt,ct);if(Ka(nt))return at(_e,it,nt,ct);th(_e,nt)}return typeof nt=="string"&&nt!==""||typeof nt=="number"?(nt=""+nt,it!==null&&it.tag===6?(a(_e,it.sibling),it=c(it,nt),it.return=_e,_e=it):(a(_e,it),it=xh(nt,_e.mode,ct),it.return=_e,_e=it),g(_e)):a(_e,it)}return lt}var Bh=vh(!0),Ch=vh(!1),Dh={},Eh=Uf(Dh),Fh=Uf(Dh),Gh=Uf(Dh);function Hh(s){if(s===Dh)throw Error(p(174));return s}function Ih(s,e){switch(G(Gh,e),G(Fh,s),G(Eh,Dh),s=e.nodeType,s){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:lb(null,"");break;default:s=s===8?e.parentNode:e,e=s.namespaceURI||null,s=s.tagName,e=lb(e,s)}E(Eh),G(Eh,e)}function Jh(){E(Eh),E(Fh),E(Gh)}function Kh(s){Hh(Gh.current);var e=Hh(Eh.current),a=lb(e,s.type);e!==a&&(G(Fh,s),G(Eh,a))}function Lh(s){Fh.current===s&&(E(Eh),E(Fh))}var M=Uf(0);function Mh(s){for(var e=s;e!==null;){if(e.tag===13){var a=e.memoizedState;if(a!==null&&(a=a.dehydrated,a===null||a.data==="$?"||a.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if(e.flags&128)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===s)break;for(;e.sibling===null;){if(e.return===null||e.return===s)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var Nh=[];function Oh(){for(var s=0;s<Nh.length;s++)Nh[s]._workInProgressVersionPrimary=null;Nh.length=0}var Ph=ua.ReactCurrentDispatcher,Qh=ua.ReactCurrentBatchConfig,Rh=0,N=null,O=null,P=null,Sh=!1,Th=!1,Uh=0,Vh=0;function Q(){throw Error(p(321))}function Wh(s,e){if(e===null)return!1;for(var a=0;a<e.length&&a<s.length;a++)if(!He(s[a],e[a]))return!1;return!0}function Xh(s,e,a,o,c,d){if(Rh=d,N=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,Ph.current=s===null||s.memoizedState===null?Yh:Zh,s=a(o,c),Th){d=0;do{if(Th=!1,Uh=0,25<=d)throw Error(p(301));d+=1,P=O=null,e.updateQueue=null,Ph.current=$h,s=a(o,c)}while(Th)}if(Ph.current=ai,e=O!==null&&O.next!==null,Rh=0,P=O=N=null,Sh=!1,e)throw Error(p(300));return s}function bi(){var s=Uh!==0;return Uh=0,s}function ci(){var s={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return P===null?N.memoizedState=P=s:P=P.next=s,P}function di(){if(O===null){var s=N.alternate;s=s!==null?s.memoizedState:null}else s=O.next;var e=P===null?N.memoizedState:P.next;if(e!==null)P=e,O=s;else{if(s===null)throw Error(p(310));O=s,s={memoizedState:O.memoizedState,baseState:O.baseState,baseQueue:O.baseQueue,queue:O.queue,next:null},P===null?N.memoizedState=P=s:P=P.next=s}return P}function ei(s,e){return typeof e=="function"?e(s):e}function fi(s){var e=di(),a=e.queue;if(a===null)throw Error(p(311));a.lastRenderedReducer=s;var o=O,c=o.baseQueue,d=a.pending;if(d!==null){if(c!==null){var g=c.next;c.next=d.next,d.next=g}o.baseQueue=c=d,a.pending=null}if(c!==null){d=c.next,o=o.baseState;var _=g=null,b=null,$=d;do{var tt=$.lane;if((Rh&tt)===tt)b!==null&&(b=b.next={lane:0,action:$.action,hasEagerState:$.hasEagerState,eagerState:$.eagerState,next:null}),o=$.hasEagerState?$.eagerState:s(o,$.action);else{var rt={lane:tt,action:$.action,hasEagerState:$.hasEagerState,eagerState:$.eagerState,next:null};b===null?(_=b=rt,g=o):b=b.next=rt,N.lanes|=tt,hh|=tt}$=$.next}while($!==null&&$!==d);b===null?g=o:b.next=_,He(o,e.memoizedState)||(Ug=!0),e.memoizedState=o,e.baseState=g,e.baseQueue=b,a.lastRenderedState=o}if(s=a.interleaved,s!==null){c=s;do d=c.lane,N.lanes|=d,hh|=d,c=c.next;while(c!==s)}else c===null&&(a.lanes=0);return[e.memoizedState,a.dispatch]}function gi(s){var e=di(),a=e.queue;if(a===null)throw Error(p(311));a.lastRenderedReducer=s;var o=a.dispatch,c=a.pending,d=e.memoizedState;if(c!==null){a.pending=null;var g=c=c.next;do d=s(d,g.action),g=g.next;while(g!==c);He(d,e.memoizedState)||(Ug=!0),e.memoizedState=d,e.baseQueue===null&&(e.baseState=d),a.lastRenderedState=d}return[d,o]}function hi(){}function ii(s,e){var a=N,o=di(),c=e(),d=!He(o.memoizedState,c);if(d&&(o.memoizedState=c,Ug=!0),o=o.queue,ji(ki.bind(null,a,o,s),[s]),o.getSnapshot!==e||d||P!==null&&P.memoizedState.tag&1){if(a.flags|=2048,li(9,mi.bind(null,a,o,c,e),void 0,null),R===null)throw Error(p(349));Rh&30||ni(a,e,c)}return c}function ni(s,e,a){s.flags|=16384,s={getSnapshot:e,value:a},e=N.updateQueue,e===null?(e={lastEffect:null,stores:null},N.updateQueue=e,e.stores=[s]):(a=e.stores,a===null?e.stores=[s]:a.push(s))}function mi(s,e,a,o){e.value=a,e.getSnapshot=o,oi(e)&&pi(s)}function ki(s,e,a){return a(function(){oi(e)&&pi(s)})}function oi(s){var e=s.getSnapshot;s=s.value;try{var a=e();return!He(s,a)}catch{return!0}}function pi(s){var e=Zg(s,1);e!==null&&mh(e,s,1,-1)}function qi(s){var e=ci();return typeof s=="function"&&(s=s()),e.memoizedState=e.baseState=s,s={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:ei,lastRenderedState:s},e.queue=s,s=s.dispatch=ri.bind(null,N,s),[e.memoizedState,s]}function li(s,e,a,o){return s={tag:s,create:e,destroy:a,deps:o,next:null},e=N.updateQueue,e===null?(e={lastEffect:null,stores:null},N.updateQueue=e,e.lastEffect=s.next=s):(a=e.lastEffect,a===null?e.lastEffect=s.next=s:(o=a.next,a.next=s,s.next=o,e.lastEffect=s)),s}function si(){return di().memoizedState}function ti(s,e,a,o){var c=ci();N.flags|=s,c.memoizedState=li(1|e,a,void 0,o===void 0?null:o)}function ui(s,e,a,o){var c=di();o=o===void 0?null:o;var d=void 0;if(O!==null){var g=O.memoizedState;if(d=g.destroy,o!==null&&Wh(o,g.deps)){c.memoizedState=li(e,a,d,o);return}}N.flags|=s,c.memoizedState=li(1|e,a,d,o)}function vi(s,e){return ti(8390656,8,s,e)}function ji(s,e){return ui(2048,8,s,e)}function wi(s,e){return ui(4,2,s,e)}function xi(s,e){return ui(4,4,s,e)}function yi(s,e){if(typeof e=="function")return s=s(),e(s),function(){e(null)};if(e!=null)return s=s(),e.current=s,function(){e.current=null}}function zi(s,e,a){return a=a!=null?a.concat([s]):null,ui(4,4,yi.bind(null,e,s),a)}function Ai(){}function Bi(s,e){var a=di();e=e===void 0?null:e;var o=a.memoizedState;return o!==null&&e!==null&&Wh(e,o[1])?o[0]:(a.memoizedState=[s,e],s)}function Ci(s,e){var a=di();e=e===void 0?null:e;var o=a.memoizedState;return o!==null&&e!==null&&Wh(e,o[1])?o[0]:(s=s(),a.memoizedState=[s,e],s)}function Di(s,e,a){return Rh&21?(He(a,e)||(a=yc(),N.lanes|=a,hh|=a,s.baseState=!0),e):(s.baseState&&(s.baseState=!1,Ug=!0),s.memoizedState=a)}function Ei(s,e){var a=C;C=a!==0&&4>a?a:4,s(!0);var o=Qh.transition;Qh.transition={};try{s(!1),e()}finally{C=a,Qh.transition=o}}function Fi(){return di().memoizedState}function Gi(s,e,a){var o=lh(s);if(a={lane:o,action:a,hasEagerState:!1,eagerState:null,next:null},Hi(s))Ii(e,a);else if(a=Yg(s,e,a,o),a!==null){var c=L();mh(a,s,o,c),Ji(a,e,o)}}function ri(s,e,a){var o=lh(s),c={lane:o,action:a,hasEagerState:!1,eagerState:null,next:null};if(Hi(s))Ii(e,c);else{var d=s.alternate;if(s.lanes===0&&(d===null||d.lanes===0)&&(d=e.lastRenderedReducer,d!==null))try{var g=e.lastRenderedState,_=d(g,a);if(c.hasEagerState=!0,c.eagerState=_,He(_,g)){var b=e.interleaved;b===null?(c.next=c,Xg(e)):(c.next=b.next,b.next=c),e.interleaved=c;return}}catch{}finally{}a=Yg(s,e,c,o),a!==null&&(c=L(),mh(a,s,o,c),Ji(a,e,o))}}function Hi(s){var e=s.alternate;return s===N||e!==null&&e===N}function Ii(s,e){Th=Sh=!0;var a=s.pending;a===null?e.next=e:(e.next=a.next,a.next=e),s.pending=e}function Ji(s,e,a){if(a&4194240){var o=e.lanes;o&=s.pendingLanes,a|=o,e.lanes=a,Cc(s,a)}}var ai={readContext:Vg,useCallback:Q,useContext:Q,useEffect:Q,useImperativeHandle:Q,useInsertionEffect:Q,useLayoutEffect:Q,useMemo:Q,useReducer:Q,useRef:Q,useState:Q,useDebugValue:Q,useDeferredValue:Q,useTransition:Q,useMutableSource:Q,useSyncExternalStore:Q,useId:Q,unstable_isNewReconciler:!1},Yh={readContext:Vg,useCallback:function(s,e){return ci().memoizedState=[s,e===void 0?null:e],s},useContext:Vg,useEffect:vi,useImperativeHandle:function(s,e,a){return a=a!=null?a.concat([s]):null,ti(4194308,4,yi.bind(null,e,s),a)},useLayoutEffect:function(s,e){return ti(4194308,4,s,e)},useInsertionEffect:function(s,e){return ti(4,2,s,e)},useMemo:function(s,e){var a=ci();return e=e===void 0?null:e,s=s(),a.memoizedState=[s,e],s},useReducer:function(s,e,a){var o=ci();return e=a!==void 0?a(e):e,o.memoizedState=o.baseState=e,s={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:s,lastRenderedState:e},o.queue=s,s=s.dispatch=Gi.bind(null,N,s),[o.memoizedState,s]},useRef:function(s){var e=ci();return s={current:s},e.memoizedState=s},useState:qi,useDebugValue:Ai,useDeferredValue:function(s){return ci().memoizedState=s},useTransition:function(){var s=qi(!1),e=s[0];return s=Ei.bind(null,s[1]),ci().memoizedState=s,[e,s]},useMutableSource:function(){},useSyncExternalStore:function(s,e,a){var o=N,c=ci();if(I){if(a===void 0)throw Error(p(407));a=a()}else{if(a=e(),R===null)throw Error(p(349));Rh&30||ni(o,e,a)}c.memoizedState=a;var d={value:a,getSnapshot:e};return c.queue=d,vi(ki.bind(null,o,d,s),[s]),o.flags|=2048,li(9,mi.bind(null,o,d,a,e),void 0,null),a},useId:function(){var s=ci(),e=R.identifierPrefix;if(I){var a=sg,o=rg;a=(o&~(1<<32-oc(o)-1)).toString(32)+a,e=":"+e+"R"+a,a=Uh++,0<a&&(e+="H"+a.toString(32)),e+=":"}else a=Vh++,e=":"+e+"r"+a.toString(32)+":";return s.memoizedState=e},unstable_isNewReconciler:!1},Zh={readContext:Vg,useCallback:Bi,useContext:Vg,useEffect:ji,useImperativeHandle:zi,useInsertionEffect:wi,useLayoutEffect:xi,useMemo:Ci,useReducer:fi,useRef:si,useState:function(){return fi(ei)},useDebugValue:Ai,useDeferredValue:function(s){var e=di();return Di(e,O.memoizedState,s)},useTransition:function(){var s=fi(ei)[0],e=di().memoizedState;return[s,e]},useMutableSource:hi,useSyncExternalStore:ii,useId:Fi,unstable_isNewReconciler:!1},$h={readContext:Vg,useCallback:Bi,useContext:Vg,useEffect:ji,useImperativeHandle:zi,useInsertionEffect:wi,useLayoutEffect:xi,useMemo:Ci,useReducer:gi,useRef:si,useState:function(){return gi(ei)},useDebugValue:Ai,useDeferredValue:function(s){var e=di();return O===null?e.memoizedState=s:Di(e,O.memoizedState,s)},useTransition:function(){var s=gi(ei)[0],e=di().memoizedState;return[s,e]},useMutableSource:hi,useSyncExternalStore:ii,useId:Fi,unstable_isNewReconciler:!1};function Ki(s,e){try{var a="",o=e;do a+=Pa(o),o=o.return;while(o);var c=a}catch(d){c=`
Error generating stack: `+d.message+`
`+d.stack}return{value:s,source:e,stack:c,digest:null}}function Li(s,e,a){return{value:s,source:null,stack:a??null,digest:e??null}}function Mi(s,e){try{console.error(e.value)}catch(a){setTimeout(function(){throw a})}}var Ni=typeof WeakMap=="function"?WeakMap:Map;function Oi(s,e,a){a=ch(-1,a),a.tag=3,a.payload={element:null};var o=e.value;return a.callback=function(){Pi||(Pi=!0,Qi=o),Mi(s,e)},a}function Ri(s,e,a){a=ch(-1,a),a.tag=3;var o=s.type.getDerivedStateFromError;if(typeof o=="function"){var c=e.value;a.payload=function(){return o(c)},a.callback=function(){Mi(s,e)}}var d=s.stateNode;return d!==null&&typeof d.componentDidCatch=="function"&&(a.callback=function(){Mi(s,e),typeof o!="function"&&(Si===null?Si=new Set([this]):Si.add(this));var g=e.stack;this.componentDidCatch(e.value,{componentStack:g!==null?g:""})}),a}function Ti(s,e,a){var o=s.pingCache;if(o===null){o=s.pingCache=new Ni;var c=new Set;o.set(e,c)}else c=o.get(e),c===void 0&&(c=new Set,o.set(e,c));c.has(a)||(c.add(a),s=Ui.bind(null,s,e,a),e.then(s,s))}function Vi(s){do{var e;if((e=s.tag===13)&&(e=s.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return s;s=s.return}while(s!==null);return null}function Wi(s,e,a,o,c){return s.mode&1?(s.flags|=65536,s.lanes=c,s):(s===e?s.flags|=65536:(s.flags|=128,a.flags|=131072,a.flags&=-52805,a.tag===1&&(a.alternate===null?a.tag=17:(e=ch(-1,1),e.tag=2,dh(a,e,1))),a.lanes|=1),s)}var Xi=ua.ReactCurrentOwner,Ug=!1;function Yi(s,e,a,o){e.child=s===null?Ch(e,null,a,o):Bh(e,s.child,a,o)}function Zi(s,e,a,o,c){a=a.render;var d=e.ref;return Tg(e,c),o=Xh(s,e,a,o,d,c),a=bi(),s!==null&&!Ug?(e.updateQueue=s.updateQueue,e.flags&=-2053,s.lanes&=~c,$i(s,e,c)):(I&&a&&vg(e),e.flags|=1,Yi(s,e,o,c),e.child)}function aj(s,e,a,o,c){if(s===null){var d=a.type;return typeof d=="function"&&!bj(d)&&d.defaultProps===void 0&&a.compare===null&&a.defaultProps===void 0?(e.tag=15,e.type=d,cj(s,e,d,o,c)):(s=yh(a.type,null,o,e,e.mode,c),s.ref=e.ref,s.return=e,e.child=s)}if(d=s.child,!(s.lanes&c)){var g=d.memoizedProps;if(a=a.compare,a=a!==null?a:Ie,a(g,o)&&s.ref===e.ref)return $i(s,e,c)}return e.flags|=1,s=wh(d,o),s.ref=e.ref,s.return=e,e.child=s}function cj(s,e,a,o,c){if(s!==null){var d=s.memoizedProps;if(Ie(d,o)&&s.ref===e.ref)if(Ug=!1,e.pendingProps=o=d,(s.lanes&c)!==0)s.flags&131072&&(Ug=!0);else return e.lanes=s.lanes,$i(s,e,c)}return dj(s,e,a,o,c)}function ej(s,e,a){var o=e.pendingProps,c=o.children,d=s!==null?s.memoizedState:null;if(o.mode==="hidden")if(!(e.mode&1))e.memoizedState={baseLanes:0,cachePool:null,transitions:null},G(fj,gj),gj|=a;else{if(!(a&1073741824))return s=d!==null?d.baseLanes|a:a,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:s,cachePool:null,transitions:null},e.updateQueue=null,G(fj,gj),gj|=s,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},o=d!==null?d.baseLanes:a,G(fj,gj),gj|=o}else d!==null?(o=d.baseLanes|a,e.memoizedState=null):o=a,G(fj,gj),gj|=o;return Yi(s,e,c,a),e.child}function hj(s,e){var a=e.ref;(s===null&&a!==null||s!==null&&s.ref!==a)&&(e.flags|=512,e.flags|=2097152)}function dj(s,e,a,o,c){var d=Zf(a)?Xf:H.current;return d=Yf(e,d),Tg(e,c),a=Xh(s,e,a,o,d,c),o=bi(),s!==null&&!Ug?(e.updateQueue=s.updateQueue,e.flags&=-2053,s.lanes&=~c,$i(s,e,c)):(I&&o&&vg(e),e.flags|=1,Yi(s,e,a,c),e.child)}function ij(s,e,a,o,c){if(Zf(a)){var d=!0;cg(e)}else d=!1;if(Tg(e,c),e.stateNode===null)jj(s,e),ph(e,a,o),rh(e,a,o,c),o=!0;else if(s===null){var g=e.stateNode,_=e.memoizedProps;g.props=_;var b=g.context,$=a.contextType;typeof $=="object"&&$!==null?$=Vg($):($=Zf(a)?Xf:H.current,$=Yf(e,$));var tt=a.getDerivedStateFromProps,rt=typeof tt=="function"||typeof g.getSnapshotBeforeUpdate=="function";rt||typeof g.UNSAFE_componentWillReceiveProps!="function"&&typeof g.componentWillReceiveProps!="function"||(_!==o||b!==$)&&qh(e,g,o,$),$g=!1;var et=e.memoizedState;g.state=et,gh(e,o,g,c),b=e.memoizedState,_!==o||et!==b||Wf.current||$g?(typeof tt=="function"&&(kh(e,a,tt,o),b=e.memoizedState),(_=$g||oh(e,a,_,o,et,b,$))?(rt||typeof g.UNSAFE_componentWillMount!="function"&&typeof g.componentWillMount!="function"||(typeof g.componentWillMount=="function"&&g.componentWillMount(),typeof g.UNSAFE_componentWillMount=="function"&&g.UNSAFE_componentWillMount()),typeof g.componentDidMount=="function"&&(e.flags|=4194308)):(typeof g.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=o,e.memoizedState=b),g.props=o,g.state=b,g.context=$,o=_):(typeof g.componentDidMount=="function"&&(e.flags|=4194308),o=!1)}else{g=e.stateNode,bh(s,e),_=e.memoizedProps,$=e.type===e.elementType?_:Lg(e.type,_),g.props=$,rt=e.pendingProps,et=g.context,b=a.contextType,typeof b=="object"&&b!==null?b=Vg(b):(b=Zf(a)?Xf:H.current,b=Yf(e,b));var st=a.getDerivedStateFromProps;(tt=typeof st=="function"||typeof g.getSnapshotBeforeUpdate=="function")||typeof g.UNSAFE_componentWillReceiveProps!="function"&&typeof g.componentWillReceiveProps!="function"||(_!==rt||et!==b)&&qh(e,g,o,b),$g=!1,et=e.memoizedState,g.state=et,gh(e,o,g,c);var ot=e.memoizedState;_!==rt||et!==ot||Wf.current||$g?(typeof st=="function"&&(kh(e,a,st,o),ot=e.memoizedState),($=$g||oh(e,a,$,o,et,ot,b)||!1)?(tt||typeof g.UNSAFE_componentWillUpdate!="function"&&typeof g.componentWillUpdate!="function"||(typeof g.componentWillUpdate=="function"&&g.componentWillUpdate(o,ot,b),typeof g.UNSAFE_componentWillUpdate=="function"&&g.UNSAFE_componentWillUpdate(o,ot,b)),typeof g.componentDidUpdate=="function"&&(e.flags|=4),typeof g.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof g.componentDidUpdate!="function"||_===s.memoizedProps&&et===s.memoizedState||(e.flags|=4),typeof g.getSnapshotBeforeUpdate!="function"||_===s.memoizedProps&&et===s.memoizedState||(e.flags|=1024),e.memoizedProps=o,e.memoizedState=ot),g.props=o,g.state=ot,g.context=b,o=$):(typeof g.componentDidUpdate!="function"||_===s.memoizedProps&&et===s.memoizedState||(e.flags|=4),typeof g.getSnapshotBeforeUpdate!="function"||_===s.memoizedProps&&et===s.memoizedState||(e.flags|=1024),o=!1)}return kj(s,e,a,o,d,c)}function kj(s,e,a,o,c,d){hj(s,e);var g=(e.flags&128)!==0;if(!o&&!g)return c&&dg(e,a,!1),$i(s,e,d);o=e.stateNode,Xi.current=e;var _=g&&typeof a.getDerivedStateFromError!="function"?null:o.render();return e.flags|=1,s!==null&&g?(e.child=Bh(e,s.child,null,d),e.child=Bh(e,null,_,d)):Yi(s,e,_,d),e.memoizedState=o.state,c&&dg(e,a,!0),e.child}function lj(s){var e=s.stateNode;e.pendingContext?ag(s,e.pendingContext,e.pendingContext!==e.context):e.context&&ag(s,e.context,!1),Ih(s,e.containerInfo)}function mj(s,e,a,o,c){return Ig(),Jg(c),e.flags|=256,Yi(s,e,a,o),e.child}var nj={dehydrated:null,treeContext:null,retryLane:0};function oj(s){return{baseLanes:s,cachePool:null,transitions:null}}function pj(s,e,a){var o=e.pendingProps,c=M.current,d=!1,g=(e.flags&128)!==0,_;if((_=g)||(_=s!==null&&s.memoizedState===null?!1:(c&2)!==0),_?(d=!0,e.flags&=-129):(s===null||s.memoizedState!==null)&&(c|=1),G(M,c&1),s===null)return Eg(e),s=e.memoizedState,s!==null&&(s=s.dehydrated,s!==null)?(e.mode&1?s.data==="$!"?e.lanes=8:e.lanes=1073741824:e.lanes=1,null):(g=o.children,s=o.fallback,d?(o=e.mode,d=e.child,g={mode:"hidden",children:g},!(o&1)&&d!==null?(d.childLanes=0,d.pendingProps=g):d=qj(g,o,0,null),s=Ah(s,o,a,null),d.return=e,s.return=e,d.sibling=s,e.child=d,e.child.memoizedState=oj(a),e.memoizedState=nj,s):rj(e,g));if(c=s.memoizedState,c!==null&&(_=c.dehydrated,_!==null))return sj(s,e,g,o,_,c,a);if(d){d=o.fallback,g=e.mode,c=s.child,_=c.sibling;var b={mode:"hidden",children:o.children};return!(g&1)&&e.child!==c?(o=e.child,o.childLanes=0,o.pendingProps=b,e.deletions=null):(o=wh(c,b),o.subtreeFlags=c.subtreeFlags&14680064),_!==null?d=wh(_,d):(d=Ah(d,g,a,null),d.flags|=2),d.return=e,o.return=e,o.sibling=d,e.child=o,o=d,d=e.child,g=s.child.memoizedState,g=g===null?oj(a):{baseLanes:g.baseLanes|a,cachePool:null,transitions:g.transitions},d.memoizedState=g,d.childLanes=s.childLanes&~a,e.memoizedState=nj,o}return d=s.child,s=d.sibling,o=wh(d,{mode:"visible",children:o.children}),!(e.mode&1)&&(o.lanes=a),o.return=e,o.sibling=null,s!==null&&(a=e.deletions,a===null?(e.deletions=[s],e.flags|=16):a.push(s)),e.child=o,e.memoizedState=null,o}function rj(s,e){return e=qj({mode:"visible",children:e},s.mode,0,null),e.return=s,s.child=e}function tj(s,e,a,o){return o!==null&&Jg(o),Bh(e,s.child,null,a),s=rj(e,e.pendingProps.children),s.flags|=2,e.memoizedState=null,s}function sj(s,e,a,o,c,d,g){if(a)return e.flags&256?(e.flags&=-257,o=Li(Error(p(422))),tj(s,e,g,o)):e.memoizedState!==null?(e.child=s.child,e.flags|=128,null):(d=o.fallback,c=e.mode,o=qj({mode:"visible",children:o.children},c,0,null),d=Ah(d,c,g,null),d.flags|=2,o.return=e,d.return=e,o.sibling=d,e.child=o,e.mode&1&&Bh(e,s.child,null,g),e.child.memoizedState=oj(g),e.memoizedState=nj,d);if(!(e.mode&1))return tj(s,e,g,null);if(c.data==="$!"){if(o=c.nextSibling&&c.nextSibling.dataset,o)var _=o.dgst;return o=_,d=Error(p(419)),o=Li(d,o,void 0),tj(s,e,g,o)}if(_=(g&s.childLanes)!==0,Ug||_){if(o=R,o!==null){switch(g&-g){case 4:c=2;break;case 16:c=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:c=32;break;case 536870912:c=268435456;break;default:c=0}c=c&(o.suspendedLanes|g)?0:c,c!==0&&c!==d.retryLane&&(d.retryLane=c,Zg(s,c),mh(o,s,c,-1))}return uj(),o=Li(Error(p(421))),tj(s,e,g,o)}return c.data==="$?"?(e.flags|=128,e.child=s.child,e=vj.bind(null,s),c._reactRetry=e,null):(s=d.treeContext,yg=Lf(c.nextSibling),xg=e,I=!0,zg=null,s!==null&&(og[pg++]=rg,og[pg++]=sg,og[pg++]=qg,rg=s.id,sg=s.overflow,qg=e),e=rj(e,o.children),e.flags|=4096,e)}function wj(s,e,a){s.lanes|=e;var o=s.alternate;o!==null&&(o.lanes|=e),Sg(s.return,e,a)}function xj(s,e,a,o,c){var d=s.memoizedState;d===null?s.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:o,tail:a,tailMode:c}:(d.isBackwards=e,d.rendering=null,d.renderingStartTime=0,d.last=o,d.tail=a,d.tailMode=c)}function yj(s,e,a){var o=e.pendingProps,c=o.revealOrder,d=o.tail;if(Yi(s,e,o.children,a),o=M.current,o&2)o=o&1|2,e.flags|=128;else{if(s!==null&&s.flags&128)e:for(s=e.child;s!==null;){if(s.tag===13)s.memoizedState!==null&&wj(s,a,e);else if(s.tag===19)wj(s,a,e);else if(s.child!==null){s.child.return=s,s=s.child;continue}if(s===e)break e;for(;s.sibling===null;){if(s.return===null||s.return===e)break e;s=s.return}s.sibling.return=s.return,s=s.sibling}o&=1}if(G(M,o),!(e.mode&1))e.memoizedState=null;else switch(c){case"forwards":for(a=e.child,c=null;a!==null;)s=a.alternate,s!==null&&Mh(s)===null&&(c=a),a=a.sibling;a=c,a===null?(c=e.child,e.child=null):(c=a.sibling,a.sibling=null),xj(e,!1,c,a,d);break;case"backwards":for(a=null,c=e.child,e.child=null;c!==null;){if(s=c.alternate,s!==null&&Mh(s)===null){e.child=c;break}s=c.sibling,c.sibling=a,a=c,c=s}xj(e,!0,a,null,d);break;case"together":xj(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function jj(s,e){!(e.mode&1)&&s!==null&&(s.alternate=null,e.alternate=null,e.flags|=2)}function $i(s,e,a){if(s!==null&&(e.dependencies=s.dependencies),hh|=e.lanes,!(a&e.childLanes))return null;if(s!==null&&e.child!==s.child)throw Error(p(153));if(e.child!==null){for(s=e.child,a=wh(s,s.pendingProps),e.child=a,a.return=e;s.sibling!==null;)s=s.sibling,a=a.sibling=wh(s,s.pendingProps),a.return=e;a.sibling=null}return e.child}function zj(s,e,a){switch(e.tag){case 3:lj(e),Ig();break;case 5:Kh(e);break;case 1:Zf(e.type)&&cg(e);break;case 4:Ih(e,e.stateNode.containerInfo);break;case 10:var o=e.type._context,c=e.memoizedProps.value;G(Mg,o._currentValue),o._currentValue=c;break;case 13:if(o=e.memoizedState,o!==null)return o.dehydrated!==null?(G(M,M.current&1),e.flags|=128,null):a&e.child.childLanes?pj(s,e,a):(G(M,M.current&1),s=$i(s,e,a),s!==null?s.sibling:null);G(M,M.current&1);break;case 19:if(o=(a&e.childLanes)!==0,s.flags&128){if(o)return yj(s,e,a);e.flags|=128}if(c=e.memoizedState,c!==null&&(c.rendering=null,c.tail=null,c.lastEffect=null),G(M,M.current),o)break;return null;case 22:case 23:return e.lanes=0,ej(s,e,a)}return $i(s,e,a)}var Aj,Bj,Cj,Dj;Aj=function(s,e){for(var a=e.child;a!==null;){if(a.tag===5||a.tag===6)s.appendChild(a.stateNode);else if(a.tag!==4&&a.child!==null){a.child.return=a,a=a.child;continue}if(a===e)break;for(;a.sibling===null;){if(a.return===null||a.return===e)return;a=a.return}a.sibling.return=a.return,a=a.sibling}};Bj=function(){};Cj=function(s,e,a,o){var c=s.memoizedProps;if(c!==o){s=e.stateNode,Hh(Eh.current);var d=null;switch(a){case"input":c=Ya(s,c),o=Ya(s,o),d=[];break;case"select":c=A({},c,{value:void 0}),o=A({},o,{value:void 0}),d=[];break;case"textarea":c=gb(s,c),o=gb(s,o),d=[];break;default:typeof c.onClick!="function"&&typeof o.onClick=="function"&&(s.onclick=Bf)}ub(a,o);var g;a=null;for($ in c)if(!o.hasOwnProperty($)&&c.hasOwnProperty($)&&c[$]!=null)if($==="style"){var _=c[$];for(g in _)_.hasOwnProperty(g)&&(a||(a={}),a[g]="")}else $!=="dangerouslySetInnerHTML"&&$!=="children"&&$!=="suppressContentEditableWarning"&&$!=="suppressHydrationWarning"&&$!=="autoFocus"&&(ea.hasOwnProperty($)?d||(d=[]):(d=d||[]).push($,null));for($ in o){var b=o[$];if(_=c!=null?c[$]:void 0,o.hasOwnProperty($)&&b!==_&&(b!=null||_!=null))if($==="style")if(_){for(g in _)!_.hasOwnProperty(g)||b&&b.hasOwnProperty(g)||(a||(a={}),a[g]="");for(g in b)b.hasOwnProperty(g)&&_[g]!==b[g]&&(a||(a={}),a[g]=b[g])}else a||(d||(d=[]),d.push($,a)),a=b;else $==="dangerouslySetInnerHTML"?(b=b?b.__html:void 0,_=_?_.__html:void 0,b!=null&&_!==b&&(d=d||[]).push($,b)):$==="children"?typeof b!="string"&&typeof b!="number"||(d=d||[]).push($,""+b):$!=="suppressContentEditableWarning"&&$!=="suppressHydrationWarning"&&(ea.hasOwnProperty($)?(b!=null&&$==="onScroll"&&D("scroll",s),d||_===b||(d=[])):(d=d||[]).push($,b))}a&&(d=d||[]).push("style",a);var $=d;(e.updateQueue=$)&&(e.flags|=4)}};Dj=function(s,e,a,o){a!==o&&(e.flags|=4)};function Ej(s,e){if(!I)switch(s.tailMode){case"hidden":e=s.tail;for(var a=null;e!==null;)e.alternate!==null&&(a=e),e=e.sibling;a===null?s.tail=null:a.sibling=null;break;case"collapsed":a=s.tail;for(var o=null;a!==null;)a.alternate!==null&&(o=a),a=a.sibling;o===null?e||s.tail===null?s.tail=null:s.tail.sibling=null:o.sibling=null}}function S(s){var e=s.alternate!==null&&s.alternate.child===s.child,a=0,o=0;if(e)for(var c=s.child;c!==null;)a|=c.lanes|c.childLanes,o|=c.subtreeFlags&14680064,o|=c.flags&14680064,c.return=s,c=c.sibling;else for(c=s.child;c!==null;)a|=c.lanes|c.childLanes,o|=c.subtreeFlags,o|=c.flags,c.return=s,c=c.sibling;return s.subtreeFlags|=o,s.childLanes=a,e}function Fj(s,e,a){var o=e.pendingProps;switch(wg(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return S(e),null;case 1:return Zf(e.type)&&$f(),S(e),null;case 3:return o=e.stateNode,Jh(),E(Wf),E(H),Oh(),o.pendingContext&&(o.context=o.pendingContext,o.pendingContext=null),(s===null||s.child===null)&&(Gg(e)?e.flags|=4:s===null||s.memoizedState.isDehydrated&&!(e.flags&256)||(e.flags|=1024,zg!==null&&(Gj(zg),zg=null))),Bj(s,e),S(e),null;case 5:Lh(e);var c=Hh(Gh.current);if(a=e.type,s!==null&&e.stateNode!=null)Cj(s,e,a,o,c),s.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!o){if(e.stateNode===null)throw Error(p(166));return S(e),null}if(s=Hh(Eh.current),Gg(e)){o=e.stateNode,a=e.type;var d=e.memoizedProps;switch(o[Of]=e,o[Pf]=d,s=(e.mode&1)!==0,a){case"dialog":D("cancel",o),D("close",o);break;case"iframe":case"object":case"embed":D("load",o);break;case"video":case"audio":for(c=0;c<lf.length;c++)D(lf[c],o);break;case"source":D("error",o);break;case"img":case"image":case"link":D("error",o),D("load",o);break;case"details":D("toggle",o);break;case"input":Za(o,d),D("invalid",o);break;case"select":o._wrapperState={wasMultiple:!!d.multiple},D("invalid",o);break;case"textarea":hb(o,d),D("invalid",o)}ub(a,d),c=null;for(var g in d)if(d.hasOwnProperty(g)){var _=d[g];g==="children"?typeof _=="string"?o.textContent!==_&&(d.suppressHydrationWarning!==!0&&Af(o.textContent,_,s),c=["children",_]):typeof _=="number"&&o.textContent!==""+_&&(d.suppressHydrationWarning!==!0&&Af(o.textContent,_,s),c=["children",""+_]):ea.hasOwnProperty(g)&&_!=null&&g==="onScroll"&&D("scroll",o)}switch(a){case"input":Va(o),db(o,d,!0);break;case"textarea":Va(o),jb(o);break;case"select":case"option":break;default:typeof d.onClick=="function"&&(o.onclick=Bf)}o=c,e.updateQueue=o,o!==null&&(e.flags|=4)}else{g=c.nodeType===9?c:c.ownerDocument,s==="http://www.w3.org/1999/xhtml"&&(s=kb(a)),s==="http://www.w3.org/1999/xhtml"?a==="script"?(s=g.createElement("div"),s.innerHTML="<script><\/script>",s=s.removeChild(s.firstChild)):typeof o.is=="string"?s=g.createElement(a,{is:o.is}):(s=g.createElement(a),a==="select"&&(g=s,o.multiple?g.multiple=!0:o.size&&(g.size=o.size))):s=g.createElementNS(s,a),s[Of]=e,s[Pf]=o,Aj(s,e,!1,!1),e.stateNode=s;e:{switch(g=vb(a,o),a){case"dialog":D("cancel",s),D("close",s),c=o;break;case"iframe":case"object":case"embed":D("load",s),c=o;break;case"video":case"audio":for(c=0;c<lf.length;c++)D(lf[c],s);c=o;break;case"source":D("error",s),c=o;break;case"img":case"image":case"link":D("error",s),D("load",s),c=o;break;case"details":D("toggle",s),c=o;break;case"input":Za(s,o),c=Ya(s,o),D("invalid",s);break;case"option":c=o;break;case"select":s._wrapperState={wasMultiple:!!o.multiple},c=A({},o,{value:void 0}),D("invalid",s);break;case"textarea":hb(s,o),c=gb(s,o),D("invalid",s);break;default:c=o}ub(a,c),_=c;for(d in _)if(_.hasOwnProperty(d)){var b=_[d];d==="style"?sb(s,b):d==="dangerouslySetInnerHTML"?(b=b?b.__html:void 0,b!=null&&nb(s,b)):d==="children"?typeof b=="string"?(a!=="textarea"||b!=="")&&ob(s,b):typeof b=="number"&&ob(s,""+b):d!=="suppressContentEditableWarning"&&d!=="suppressHydrationWarning"&&d!=="autoFocus"&&(ea.hasOwnProperty(d)?b!=null&&d==="onScroll"&&D("scroll",s):b!=null&&ta(s,d,b,g))}switch(a){case"input":Va(s),db(s,o,!1);break;case"textarea":Va(s),jb(s);break;case"option":o.value!=null&&s.setAttribute("value",""+Sa(o.value));break;case"select":s.multiple=!!o.multiple,d=o.value,d!=null?fb(s,!!o.multiple,d,!1):o.defaultValue!=null&&fb(s,!!o.multiple,o.defaultValue,!0);break;default:typeof c.onClick=="function"&&(s.onclick=Bf)}switch(a){case"button":case"input":case"select":case"textarea":o=!!o.autoFocus;break e;case"img":o=!0;break e;default:o=!1}}o&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return S(e),null;case 6:if(s&&e.stateNode!=null)Dj(s,e,s.memoizedProps,o);else{if(typeof o!="string"&&e.stateNode===null)throw Error(p(166));if(a=Hh(Gh.current),Hh(Eh.current),Gg(e)){if(o=e.stateNode,a=e.memoizedProps,o[Of]=e,(d=o.nodeValue!==a)&&(s=xg,s!==null))switch(s.tag){case 3:Af(o.nodeValue,a,(s.mode&1)!==0);break;case 5:s.memoizedProps.suppressHydrationWarning!==!0&&Af(o.nodeValue,a,(s.mode&1)!==0)}d&&(e.flags|=4)}else o=(a.nodeType===9?a:a.ownerDocument).createTextNode(o),o[Of]=e,e.stateNode=o}return S(e),null;case 13:if(E(M),o=e.memoizedState,s===null||s.memoizedState!==null&&s.memoizedState.dehydrated!==null){if(I&&yg!==null&&e.mode&1&&!(e.flags&128))Hg(),Ig(),e.flags|=98560,d=!1;else if(d=Gg(e),o!==null&&o.dehydrated!==null){if(s===null){if(!d)throw Error(p(318));if(d=e.memoizedState,d=d!==null?d.dehydrated:null,!d)throw Error(p(317));d[Of]=e}else Ig(),!(e.flags&128)&&(e.memoizedState=null),e.flags|=4;S(e),d=!1}else zg!==null&&(Gj(zg),zg=null),d=!0;if(!d)return e.flags&65536?e:null}return e.flags&128?(e.lanes=a,e):(o=o!==null,o!==(s!==null&&s.memoizedState!==null)&&o&&(e.child.flags|=8192,e.mode&1&&(s===null||M.current&1?T===0&&(T=3):uj())),e.updateQueue!==null&&(e.flags|=4),S(e),null);case 4:return Jh(),Bj(s,e),s===null&&sf(e.stateNode.containerInfo),S(e),null;case 10:return Rg(e.type._context),S(e),null;case 17:return Zf(e.type)&&$f(),S(e),null;case 19:if(E(M),d=e.memoizedState,d===null)return S(e),null;if(o=(e.flags&128)!==0,g=d.rendering,g===null)if(o)Ej(d,!1);else{if(T!==0||s!==null&&s.flags&128)for(s=e.child;s!==null;){if(g=Mh(s),g!==null){for(e.flags|=128,Ej(d,!1),o=g.updateQueue,o!==null&&(e.updateQueue=o,e.flags|=4),e.subtreeFlags=0,o=a,a=e.child;a!==null;)d=a,s=o,d.flags&=14680066,g=d.alternate,g===null?(d.childLanes=0,d.lanes=s,d.child=null,d.subtreeFlags=0,d.memoizedProps=null,d.memoizedState=null,d.updateQueue=null,d.dependencies=null,d.stateNode=null):(d.childLanes=g.childLanes,d.lanes=g.lanes,d.child=g.child,d.subtreeFlags=0,d.deletions=null,d.memoizedProps=g.memoizedProps,d.memoizedState=g.memoizedState,d.updateQueue=g.updateQueue,d.type=g.type,s=g.dependencies,d.dependencies=s===null?null:{lanes:s.lanes,firstContext:s.firstContext}),a=a.sibling;return G(M,M.current&1|2),e.child}s=s.sibling}d.tail!==null&&B()>Hj&&(e.flags|=128,o=!0,Ej(d,!1),e.lanes=4194304)}else{if(!o)if(s=Mh(g),s!==null){if(e.flags|=128,o=!0,a=s.updateQueue,a!==null&&(e.updateQueue=a,e.flags|=4),Ej(d,!0),d.tail===null&&d.tailMode==="hidden"&&!g.alternate&&!I)return S(e),null}else 2*B()-d.renderingStartTime>Hj&&a!==1073741824&&(e.flags|=128,o=!0,Ej(d,!1),e.lanes=4194304);d.isBackwards?(g.sibling=e.child,e.child=g):(a=d.last,a!==null?a.sibling=g:e.child=g,d.last=g)}return d.tail!==null?(e=d.tail,d.rendering=e,d.tail=e.sibling,d.renderingStartTime=B(),e.sibling=null,a=M.current,G(M,o?a&1|2:a&1),e):(S(e),null);case 22:case 23:return Ij(),o=e.memoizedState!==null,s!==null&&s.memoizedState!==null!==o&&(e.flags|=8192),o&&e.mode&1?gj&1073741824&&(S(e),e.subtreeFlags&6&&(e.flags|=8192)):S(e),null;case 24:return null;case 25:return null}throw Error(p(156,e.tag))}function Jj(s,e){switch(wg(e),e.tag){case 1:return Zf(e.type)&&$f(),s=e.flags,s&65536?(e.flags=s&-65537|128,e):null;case 3:return Jh(),E(Wf),E(H),Oh(),s=e.flags,s&65536&&!(s&128)?(e.flags=s&-65537|128,e):null;case 5:return Lh(e),null;case 13:if(E(M),s=e.memoizedState,s!==null&&s.dehydrated!==null){if(e.alternate===null)throw Error(p(340));Ig()}return s=e.flags,s&65536?(e.flags=s&-65537|128,e):null;case 19:return E(M),null;case 4:return Jh(),null;case 10:return Rg(e.type._context),null;case 22:case 23:return Ij(),null;case 24:return null;default:return null}}var Kj=!1,U=!1,Lj=typeof WeakSet=="function"?WeakSet:Set,V=null;function Mj(s,e){var a=s.ref;if(a!==null)if(typeof a=="function")try{a(null)}catch(o){W(s,e,o)}else a.current=null}function Nj(s,e,a){try{a()}catch(o){W(s,e,o)}}var Oj=!1;function Pj(s,e){if(Cf=dd,s=Me(),Ne(s)){if("selectionStart"in s)var a={start:s.selectionStart,end:s.selectionEnd};else e:{a=(a=s.ownerDocument)&&a.defaultView||window;var o=a.getSelection&&a.getSelection();if(o&&o.rangeCount!==0){a=o.anchorNode;var c=o.anchorOffset,d=o.focusNode;o=o.focusOffset;try{a.nodeType,d.nodeType}catch{a=null;break e}var g=0,_=-1,b=-1,$=0,tt=0,rt=s,et=null;t:for(;;){for(var st;rt!==a||c!==0&&rt.nodeType!==3||(_=g+c),rt!==d||o!==0&&rt.nodeType!==3||(b=g+o),rt.nodeType===3&&(g+=rt.nodeValue.length),(st=rt.firstChild)!==null;)et=rt,rt=st;for(;;){if(rt===s)break t;if(et===a&&++$===c&&(_=g),et===d&&++tt===o&&(b=g),(st=rt.nextSibling)!==null)break;rt=et,et=rt.parentNode}rt=st}a=_===-1||b===-1?null:{start:_,end:b}}else a=null}a=a||{start:0,end:0}}else a=null;for(Df={focusedElem:s,selectionRange:a},dd=!1,V=e;V!==null;)if(e=V,s=e.child,(e.subtreeFlags&1028)!==0&&s!==null)s.return=e,V=s;else for(;V!==null;){e=V;try{var ot=e.alternate;if(e.flags&1024)switch(e.tag){case 0:case 11:case 15:break;case 1:if(ot!==null){var at=ot.memoizedProps,lt=ot.memoizedState,_e=e.stateNode,it=_e.getSnapshotBeforeUpdate(e.elementType===e.type?at:Lg(e.type,at),lt);_e.__reactInternalSnapshotBeforeUpdate=it}break;case 3:var nt=e.stateNode.containerInfo;nt.nodeType===1?nt.textContent="":nt.nodeType===9&&nt.documentElement&&nt.removeChild(nt.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(p(163))}}catch(ct){W(e,e.return,ct)}if(s=e.sibling,s!==null){s.return=e.return,V=s;break}V=e.return}return ot=Oj,Oj=!1,ot}function Qj(s,e,a){var o=e.updateQueue;if(o=o!==null?o.lastEffect:null,o!==null){var c=o=o.next;do{if((c.tag&s)===s){var d=c.destroy;c.destroy=void 0,d!==void 0&&Nj(e,a,d)}c=c.next}while(c!==o)}}function Rj(s,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var a=e=e.next;do{if((a.tag&s)===s){var o=a.create;a.destroy=o()}a=a.next}while(a!==e)}}function Sj(s){var e=s.ref;if(e!==null){var a=s.stateNode;switch(s.tag){case 5:s=a;break;default:s=a}typeof e=="function"?e(s):e.current=s}}function Tj(s){var e=s.alternate;e!==null&&(s.alternate=null,Tj(e)),s.child=null,s.deletions=null,s.sibling=null,s.tag===5&&(e=s.stateNode,e!==null&&(delete e[Of],delete e[Pf],delete e[of],delete e[Qf],delete e[Rf])),s.stateNode=null,s.return=null,s.dependencies=null,s.memoizedProps=null,s.memoizedState=null,s.pendingProps=null,s.stateNode=null,s.updateQueue=null}function Uj(s){return s.tag===5||s.tag===3||s.tag===4}function Vj(s){e:for(;;){for(;s.sibling===null;){if(s.return===null||Uj(s.return))return null;s=s.return}for(s.sibling.return=s.return,s=s.sibling;s.tag!==5&&s.tag!==6&&s.tag!==18;){if(s.flags&2||s.child===null||s.tag===4)continue e;s.child.return=s,s=s.child}if(!(s.flags&2))return s.stateNode}}function Wj(s,e,a){var o=s.tag;if(o===5||o===6)s=s.stateNode,e?a.nodeType===8?a.parentNode.insertBefore(s,e):a.insertBefore(s,e):(a.nodeType===8?(e=a.parentNode,e.insertBefore(s,a)):(e=a,e.appendChild(s)),a=a._reactRootContainer,a!=null||e.onclick!==null||(e.onclick=Bf));else if(o!==4&&(s=s.child,s!==null))for(Wj(s,e,a),s=s.sibling;s!==null;)Wj(s,e,a),s=s.sibling}function Xj(s,e,a){var o=s.tag;if(o===5||o===6)s=s.stateNode,e?a.insertBefore(s,e):a.appendChild(s);else if(o!==4&&(s=s.child,s!==null))for(Xj(s,e,a),s=s.sibling;s!==null;)Xj(s,e,a),s=s.sibling}var X=null,Yj=!1;function Zj(s,e,a){for(a=a.child;a!==null;)ak(s,e,a),a=a.sibling}function ak(s,e,a){if(lc&&typeof lc.onCommitFiberUnmount=="function")try{lc.onCommitFiberUnmount(kc,a)}catch{}switch(a.tag){case 5:U||Mj(a,e);case 6:var o=X,c=Yj;X=null,Zj(s,e,a),X=o,Yj=c,X!==null&&(Yj?(s=X,a=a.stateNode,s.nodeType===8?s.parentNode.removeChild(a):s.removeChild(a)):X.removeChild(a.stateNode));break;case 18:X!==null&&(Yj?(s=X,a=a.stateNode,s.nodeType===8?Kf(s.parentNode,a):s.nodeType===1&&Kf(s,a),bd(s)):Kf(X,a.stateNode));break;case 4:o=X,c=Yj,X=a.stateNode.containerInfo,Yj=!0,Zj(s,e,a),X=o,Yj=c;break;case 0:case 11:case 14:case 15:if(!U&&(o=a.updateQueue,o!==null&&(o=o.lastEffect,o!==null))){c=o=o.next;do{var d=c,g=d.destroy;d=d.tag,g!==void 0&&(d&2||d&4)&&Nj(a,e,g),c=c.next}while(c!==o)}Zj(s,e,a);break;case 1:if(!U&&(Mj(a,e),o=a.stateNode,typeof o.componentWillUnmount=="function"))try{o.props=a.memoizedProps,o.state=a.memoizedState,o.componentWillUnmount()}catch(_){W(a,e,_)}Zj(s,e,a);break;case 21:Zj(s,e,a);break;case 22:a.mode&1?(U=(o=U)||a.memoizedState!==null,Zj(s,e,a),U=o):Zj(s,e,a);break;default:Zj(s,e,a)}}function bk(s){var e=s.updateQueue;if(e!==null){s.updateQueue=null;var a=s.stateNode;a===null&&(a=s.stateNode=new Lj),e.forEach(function(o){var c=ck.bind(null,s,o);a.has(o)||(a.add(o),o.then(c,c))})}}function dk(s,e){var a=e.deletions;if(a!==null)for(var o=0;o<a.length;o++){var c=a[o];try{var d=s,g=e,_=g;e:for(;_!==null;){switch(_.tag){case 5:X=_.stateNode,Yj=!1;break e;case 3:X=_.stateNode.containerInfo,Yj=!0;break e;case 4:X=_.stateNode.containerInfo,Yj=!0;break e}_=_.return}if(X===null)throw Error(p(160));ak(d,g,c),X=null,Yj=!1;var b=c.alternate;b!==null&&(b.return=null),c.return=null}catch($){W(c,e,$)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)ek(e,s),e=e.sibling}function ek(s,e){var a=s.alternate,o=s.flags;switch(s.tag){case 0:case 11:case 14:case 15:if(dk(e,s),fk(s),o&4){try{Qj(3,s,s.return),Rj(3,s)}catch(at){W(s,s.return,at)}try{Qj(5,s,s.return)}catch(at){W(s,s.return,at)}}break;case 1:dk(e,s),fk(s),o&512&&a!==null&&Mj(a,a.return);break;case 5:if(dk(e,s),fk(s),o&512&&a!==null&&Mj(a,a.return),s.flags&32){var c=s.stateNode;try{ob(c,"")}catch(at){W(s,s.return,at)}}if(o&4&&(c=s.stateNode,c!=null)){var d=s.memoizedProps,g=a!==null?a.memoizedProps:d,_=s.type,b=s.updateQueue;if(s.updateQueue=null,b!==null)try{_==="input"&&d.type==="radio"&&d.name!=null&&ab(c,d),vb(_,g);var $=vb(_,d);for(g=0;g<b.length;g+=2){var tt=b[g],rt=b[g+1];tt==="style"?sb(c,rt):tt==="dangerouslySetInnerHTML"?nb(c,rt):tt==="children"?ob(c,rt):ta(c,tt,rt,$)}switch(_){case"input":bb(c,d);break;case"textarea":ib(c,d);break;case"select":var et=c._wrapperState.wasMultiple;c._wrapperState.wasMultiple=!!d.multiple;var st=d.value;st!=null?fb(c,!!d.multiple,st,!1):et!==!!d.multiple&&(d.defaultValue!=null?fb(c,!!d.multiple,d.defaultValue,!0):fb(c,!!d.multiple,d.multiple?[]:"",!1))}c[Pf]=d}catch(at){W(s,s.return,at)}}break;case 6:if(dk(e,s),fk(s),o&4){if(s.stateNode===null)throw Error(p(162));c=s.stateNode,d=s.memoizedProps;try{c.nodeValue=d}catch(at){W(s,s.return,at)}}break;case 3:if(dk(e,s),fk(s),o&4&&a!==null&&a.memoizedState.isDehydrated)try{bd(e.containerInfo)}catch(at){W(s,s.return,at)}break;case 4:dk(e,s),fk(s);break;case 13:dk(e,s),fk(s),c=s.child,c.flags&8192&&(d=c.memoizedState!==null,c.stateNode.isHidden=d,!d||c.alternate!==null&&c.alternate.memoizedState!==null||(gk=B())),o&4&&bk(s);break;case 22:if(tt=a!==null&&a.memoizedState!==null,s.mode&1?(U=($=U)||tt,dk(e,s),U=$):dk(e,s),fk(s),o&8192){if($=s.memoizedState!==null,(s.stateNode.isHidden=$)&&!tt&&s.mode&1)for(V=s,tt=s.child;tt!==null;){for(rt=V=tt;V!==null;){switch(et=V,st=et.child,et.tag){case 0:case 11:case 14:case 15:Qj(4,et,et.return);break;case 1:Mj(et,et.return);var ot=et.stateNode;if(typeof ot.componentWillUnmount=="function"){o=et,a=et.return;try{e=o,ot.props=e.memoizedProps,ot.state=e.memoizedState,ot.componentWillUnmount()}catch(at){W(o,a,at)}}break;case 5:Mj(et,et.return);break;case 22:if(et.memoizedState!==null){hk(rt);continue}}st!==null?(st.return=et,V=st):hk(rt)}tt=tt.sibling}e:for(tt=null,rt=s;;){if(rt.tag===5){if(tt===null){tt=rt;try{c=rt.stateNode,$?(d=c.style,typeof d.setProperty=="function"?d.setProperty("display","none","important"):d.display="none"):(_=rt.stateNode,b=rt.memoizedProps.style,g=b!=null&&b.hasOwnProperty("display")?b.display:null,_.style.display=rb("display",g))}catch(at){W(s,s.return,at)}}}else if(rt.tag===6){if(tt===null)try{rt.stateNode.nodeValue=$?"":rt.memoizedProps}catch(at){W(s,s.return,at)}}else if((rt.tag!==22&&rt.tag!==23||rt.memoizedState===null||rt===s)&&rt.child!==null){rt.child.return=rt,rt=rt.child;continue}if(rt===s)break e;for(;rt.sibling===null;){if(rt.return===null||rt.return===s)break e;tt===rt&&(tt=null),rt=rt.return}tt===rt&&(tt=null),rt.sibling.return=rt.return,rt=rt.sibling}}break;case 19:dk(e,s),fk(s),o&4&&bk(s);break;case 21:break;default:dk(e,s),fk(s)}}function fk(s){var e=s.flags;if(e&2){try{e:{for(var a=s.return;a!==null;){if(Uj(a)){var o=a;break e}a=a.return}throw Error(p(160))}switch(o.tag){case 5:var c=o.stateNode;o.flags&32&&(ob(c,""),o.flags&=-33);var d=Vj(s);Xj(s,d,c);break;case 3:case 4:var g=o.stateNode.containerInfo,_=Vj(s);Wj(s,_,g);break;default:throw Error(p(161))}}catch(b){W(s,s.return,b)}s.flags&=-3}e&4096&&(s.flags&=-4097)}function ik(s,e,a){V=s,jk(s)}function jk(s,e,a){for(var o=(s.mode&1)!==0;V!==null;){var c=V,d=c.child;if(c.tag===22&&o){var g=c.memoizedState!==null||Kj;if(!g){var _=c.alternate,b=_!==null&&_.memoizedState!==null||U;_=Kj;var $=U;if(Kj=g,(U=b)&&!$)for(V=c;V!==null;)g=V,b=g.child,g.tag===22&&g.memoizedState!==null?kk(c):b!==null?(b.return=g,V=b):kk(c);for(;d!==null;)V=d,jk(d),d=d.sibling;V=c,Kj=_,U=$}lk(s)}else c.subtreeFlags&8772&&d!==null?(d.return=c,V=d):lk(s)}}function lk(s){for(;V!==null;){var e=V;if(e.flags&8772){var a=e.alternate;try{if(e.flags&8772)switch(e.tag){case 0:case 11:case 15:U||Rj(5,e);break;case 1:var o=e.stateNode;if(e.flags&4&&!U)if(a===null)o.componentDidMount();else{var c=e.elementType===e.type?a.memoizedProps:Lg(e.type,a.memoizedProps);o.componentDidUpdate(c,a.memoizedState,o.__reactInternalSnapshotBeforeUpdate)}var d=e.updateQueue;d!==null&&ih(e,d,o);break;case 3:var g=e.updateQueue;if(g!==null){if(a=null,e.child!==null)switch(e.child.tag){case 5:a=e.child.stateNode;break;case 1:a=e.child.stateNode}ih(e,g,a)}break;case 5:var _=e.stateNode;if(a===null&&e.flags&4){a=_;var b=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":b.autoFocus&&a.focus();break;case"img":b.src&&(a.src=b.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var $=e.alternate;if($!==null){var tt=$.memoizedState;if(tt!==null){var rt=tt.dehydrated;rt!==null&&bd(rt)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(p(163))}U||e.flags&512&&Sj(e)}catch(et){W(e,e.return,et)}}if(e===s){V=null;break}if(a=e.sibling,a!==null){a.return=e.return,V=a;break}V=e.return}}function hk(s){for(;V!==null;){var e=V;if(e===s){V=null;break}var a=e.sibling;if(a!==null){a.return=e.return,V=a;break}V=e.return}}function kk(s){for(;V!==null;){var e=V;try{switch(e.tag){case 0:case 11:case 15:var a=e.return;try{Rj(4,e)}catch(b){W(e,a,b)}break;case 1:var o=e.stateNode;if(typeof o.componentDidMount=="function"){var c=e.return;try{o.componentDidMount()}catch(b){W(e,c,b)}}var d=e.return;try{Sj(e)}catch(b){W(e,d,b)}break;case 5:var g=e.return;try{Sj(e)}catch(b){W(e,g,b)}}}catch(b){W(e,e.return,b)}if(e===s){V=null;break}var _=e.sibling;if(_!==null){_.return=e.return,V=_;break}V=e.return}}var mk=Math.ceil,nk=ua.ReactCurrentDispatcher,ok=ua.ReactCurrentOwner,pk=ua.ReactCurrentBatchConfig,K=0,R=null,Y=null,Z=0,gj=0,fj=Uf(0),T=0,qk=null,hh=0,rk=0,sk=0,tk=null,uk=null,gk=0,Hj=1/0,vk=null,Pi=!1,Qi=null,Si=null,wk=!1,xk=null,yk=0,zk=0,Ak=null,Bk=-1,Ck=0;function L(){return K&6?B():Bk!==-1?Bk:Bk=B()}function lh(s){return s.mode&1?K&2&&Z!==0?Z&-Z:Kg.transition!==null?(Ck===0&&(Ck=yc()),Ck):(s=C,s!==0||(s=window.event,s=s===void 0?16:jd(s.type)),s):1}function mh(s,e,a,o){if(50<zk)throw zk=0,Ak=null,Error(p(185));Ac(s,a,o),(!(K&2)||s!==R)&&(s===R&&(!(K&2)&&(rk|=a),T===4&&Dk(s,Z)),Ek(s,o),a===1&&K===0&&!(e.mode&1)&&(Hj=B()+500,fg&&jg()))}function Ek(s,e){var a=s.callbackNode;wc(s,e);var o=uc(s,s===R?Z:0);if(o===0)a!==null&&bc(a),s.callbackNode=null,s.callbackPriority=0;else if(e=o&-o,s.callbackPriority!==e){if(a!=null&&bc(a),e===1)s.tag===0?ig(Fk.bind(null,s)):hg(Fk.bind(null,s)),Jf(function(){!(K&6)&&jg()}),a=null;else{switch(Dc(o)){case 1:a=fc;break;case 4:a=gc;break;case 16:a=hc;break;case 536870912:a=jc;break;default:a=hc}a=Gk(a,Hk.bind(null,s))}s.callbackPriority=e,s.callbackNode=a}}function Hk(s,e){if(Bk=-1,Ck=0,K&6)throw Error(p(327));var a=s.callbackNode;if(Ik()&&s.callbackNode!==a)return null;var o=uc(s,s===R?Z:0);if(o===0)return null;if(o&30||o&s.expiredLanes||e)e=Jk(s,o);else{e=o;var c=K;K|=2;var d=Kk();(R!==s||Z!==e)&&(vk=null,Hj=B()+500,Lk(s,e));do try{Mk();break}catch(_){Nk(s,_)}while(!0);Qg(),nk.current=d,K=c,Y!==null?e=0:(R=null,Z=0,e=T)}if(e!==0){if(e===2&&(c=xc(s),c!==0&&(o=c,e=Ok(s,c))),e===1)throw a=qk,Lk(s,0),Dk(s,o),Ek(s,B()),a;if(e===6)Dk(s,o);else{if(c=s.current.alternate,!(o&30)&&!Pk(c)&&(e=Jk(s,o),e===2&&(d=xc(s),d!==0&&(o=d,e=Ok(s,d))),e===1))throw a=qk,Lk(s,0),Dk(s,o),Ek(s,B()),a;switch(s.finishedWork=c,s.finishedLanes=o,e){case 0:case 1:throw Error(p(345));case 2:Qk(s,uk,vk);break;case 3:if(Dk(s,o),(o&130023424)===o&&(e=gk+500-B(),10<e)){if(uc(s,0)!==0)break;if(c=s.suspendedLanes,(c&o)!==o){L(),s.pingedLanes|=s.suspendedLanes&c;break}s.timeoutHandle=Ff(Qk.bind(null,s,uk,vk),e);break}Qk(s,uk,vk);break;case 4:if(Dk(s,o),(o&4194240)===o)break;for(e=s.eventTimes,c=-1;0<o;){var g=31-oc(o);d=1<<g,g=e[g],g>c&&(c=g),o&=~d}if(o=c,o=B()-o,o=(120>o?120:480>o?480:1080>o?1080:1920>o?1920:3e3>o?3e3:4320>o?4320:1960*mk(o/1960))-o,10<o){s.timeoutHandle=Ff(Qk.bind(null,s,uk,vk),o);break}Qk(s,uk,vk);break;case 5:Qk(s,uk,vk);break;default:throw Error(p(329))}}}return Ek(s,B()),s.callbackNode===a?Hk.bind(null,s):null}function Ok(s,e){var a=tk;return s.current.memoizedState.isDehydrated&&(Lk(s,e).flags|=256),s=Jk(s,e),s!==2&&(e=uk,uk=a,e!==null&&Gj(e)),s}function Gj(s){uk===null?uk=s:uk.push.apply(uk,s)}function Pk(s){for(var e=s;;){if(e.flags&16384){var a=e.updateQueue;if(a!==null&&(a=a.stores,a!==null))for(var o=0;o<a.length;o++){var c=a[o],d=c.getSnapshot;c=c.value;try{if(!He(d(),c))return!1}catch{return!1}}}if(a=e.child,e.subtreeFlags&16384&&a!==null)a.return=e,e=a;else{if(e===s)break;for(;e.sibling===null;){if(e.return===null||e.return===s)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function Dk(s,e){for(e&=~sk,e&=~rk,s.suspendedLanes|=e,s.pingedLanes&=~e,s=s.expirationTimes;0<e;){var a=31-oc(e),o=1<<a;s[a]=-1,e&=~o}}function Fk(s){if(K&6)throw Error(p(327));Ik();var e=uc(s,0);if(!(e&1))return Ek(s,B()),null;var a=Jk(s,e);if(s.tag!==0&&a===2){var o=xc(s);o!==0&&(e=o,a=Ok(s,o))}if(a===1)throw a=qk,Lk(s,0),Dk(s,e),Ek(s,B()),a;if(a===6)throw Error(p(345));return s.finishedWork=s.current.alternate,s.finishedLanes=e,Qk(s,uk,vk),Ek(s,B()),null}function Rk(s,e){var a=K;K|=1;try{return s(e)}finally{K=a,K===0&&(Hj=B()+500,fg&&jg())}}function Sk(s){xk!==null&&xk.tag===0&&!(K&6)&&Ik();var e=K;K|=1;var a=pk.transition,o=C;try{if(pk.transition=null,C=1,s)return s()}finally{C=o,pk.transition=a,K=e,!(K&6)&&jg()}}function Ij(){gj=fj.current,E(fj)}function Lk(s,e){s.finishedWork=null,s.finishedLanes=0;var a=s.timeoutHandle;if(a!==-1&&(s.timeoutHandle=-1,Gf(a)),Y!==null)for(a=Y.return;a!==null;){var o=a;switch(wg(o),o.tag){case 1:o=o.type.childContextTypes,o!=null&&$f();break;case 3:Jh(),E(Wf),E(H),Oh();break;case 5:Lh(o);break;case 4:Jh();break;case 13:E(M);break;case 19:E(M);break;case 10:Rg(o.type._context);break;case 22:case 23:Ij()}a=a.return}if(R=s,Y=s=wh(s.current,null),Z=gj=e,T=0,qk=null,sk=rk=hh=0,uk=tk=null,Wg!==null){for(e=0;e<Wg.length;e++)if(a=Wg[e],o=a.interleaved,o!==null){a.interleaved=null;var c=o.next,d=a.pending;if(d!==null){var g=d.next;d.next=c,o.next=g}a.pending=o}Wg=null}return s}function Nk(s,e){do{var a=Y;try{if(Qg(),Ph.current=ai,Sh){for(var o=N.memoizedState;o!==null;){var c=o.queue;c!==null&&(c.pending=null),o=o.next}Sh=!1}if(Rh=0,P=O=N=null,Th=!1,Uh=0,ok.current=null,a===null||a.return===null){T=1,qk=e,Y=null;break}e:{var d=s,g=a.return,_=a,b=e;if(e=Z,_.flags|=32768,b!==null&&typeof b=="object"&&typeof b.then=="function"){var $=b,tt=_,rt=tt.tag;if(!(tt.mode&1)&&(rt===0||rt===11||rt===15)){var et=tt.alternate;et?(tt.updateQueue=et.updateQueue,tt.memoizedState=et.memoizedState,tt.lanes=et.lanes):(tt.updateQueue=null,tt.memoizedState=null)}var st=Vi(g);if(st!==null){st.flags&=-257,Wi(st,g,_,d,e),st.mode&1&&Ti(d,$,e),e=st,b=$;var ot=e.updateQueue;if(ot===null){var at=new Set;at.add(b),e.updateQueue=at}else ot.add(b);break e}else{if(!(e&1)){Ti(d,$,e),uj();break e}b=Error(p(426))}}else if(I&&_.mode&1){var lt=Vi(g);if(lt!==null){!(lt.flags&65536)&&(lt.flags|=256),Wi(lt,g,_,d,e),Jg(Ki(b,_));break e}}d=b=Ki(b,_),T!==4&&(T=2),tk===null?tk=[d]:tk.push(d),d=g;do{switch(d.tag){case 3:d.flags|=65536,e&=-e,d.lanes|=e;var _e=Oi(d,b,e);fh(d,_e);break e;case 1:_=b;var it=d.type,nt=d.stateNode;if(!(d.flags&128)&&(typeof it.getDerivedStateFromError=="function"||nt!==null&&typeof nt.componentDidCatch=="function"&&(Si===null||!Si.has(nt)))){d.flags|=65536,e&=-e,d.lanes|=e;var ct=Ri(d,_,e);fh(d,ct);break e}}d=d.return}while(d!==null)}Tk(a)}catch(ht){e=ht,Y===a&&a!==null&&(Y=a=a.return);continue}break}while(!0)}function Kk(){var s=nk.current;return nk.current=ai,s===null?ai:s}function uj(){(T===0||T===3||T===2)&&(T=4),R===null||!(hh&268435455)&&!(rk&268435455)||Dk(R,Z)}function Jk(s,e){var a=K;K|=2;var o=Kk();(R!==s||Z!==e)&&(vk=null,Lk(s,e));do try{Uk();break}catch(c){Nk(s,c)}while(!0);if(Qg(),K=a,nk.current=o,Y!==null)throw Error(p(261));return R=null,Z=0,T}function Uk(){for(;Y!==null;)Vk(Y)}function Mk(){for(;Y!==null&&!cc();)Vk(Y)}function Vk(s){var e=Wk(s.alternate,s,gj);s.memoizedProps=s.pendingProps,e===null?Tk(s):Y=e,ok.current=null}function Tk(s){var e=s;do{var a=e.alternate;if(s=e.return,e.flags&32768){if(a=Jj(a,e),a!==null){a.flags&=32767,Y=a;return}if(s!==null)s.flags|=32768,s.subtreeFlags=0,s.deletions=null;else{T=6,Y=null;return}}else if(a=Fj(a,e,gj),a!==null){Y=a;return}if(e=e.sibling,e!==null){Y=e;return}Y=e=s}while(e!==null);T===0&&(T=5)}function Qk(s,e,a){var o=C,c=pk.transition;try{pk.transition=null,C=1,Xk(s,e,a,o)}finally{pk.transition=c,C=o}return null}function Xk(s,e,a,o){do Ik();while(xk!==null);if(K&6)throw Error(p(327));a=s.finishedWork;var c=s.finishedLanes;if(a===null)return null;if(s.finishedWork=null,s.finishedLanes=0,a===s.current)throw Error(p(177));s.callbackNode=null,s.callbackPriority=0;var d=a.lanes|a.childLanes;if(Bc(s,d),s===R&&(Y=R=null,Z=0),!(a.subtreeFlags&2064)&&!(a.flags&2064)||wk||(wk=!0,Gk(hc,function(){return Ik(),null})),d=(a.flags&15990)!==0,a.subtreeFlags&15990||d){d=pk.transition,pk.transition=null;var g=C;C=1;var _=K;K|=4,ok.current=null,Pj(s,a),ek(a,s),Oe(Df),dd=!!Cf,Df=Cf=null,s.current=a,ik(a),dc(),K=_,C=g,pk.transition=d}else s.current=a;if(wk&&(wk=!1,xk=s,yk=c),d=s.pendingLanes,d===0&&(Si=null),mc(a.stateNode),Ek(s,B()),e!==null)for(o=s.onRecoverableError,a=0;a<e.length;a++)c=e[a],o(c.value,{componentStack:c.stack,digest:c.digest});if(Pi)throw Pi=!1,s=Qi,Qi=null,s;return yk&1&&s.tag!==0&&Ik(),d=s.pendingLanes,d&1?s===Ak?zk++:(zk=0,Ak=s):zk=0,jg(),null}function Ik(){if(xk!==null){var s=Dc(yk),e=pk.transition,a=C;try{if(pk.transition=null,C=16>s?16:s,xk===null)var o=!1;else{if(s=xk,xk=null,yk=0,K&6)throw Error(p(331));var c=K;for(K|=4,V=s.current;V!==null;){var d=V,g=d.child;if(V.flags&16){var _=d.deletions;if(_!==null){for(var b=0;b<_.length;b++){var $=_[b];for(V=$;V!==null;){var tt=V;switch(tt.tag){case 0:case 11:case 15:Qj(8,tt,d)}var rt=tt.child;if(rt!==null)rt.return=tt,V=rt;else for(;V!==null;){tt=V;var et=tt.sibling,st=tt.return;if(Tj(tt),tt===$){V=null;break}if(et!==null){et.return=st,V=et;break}V=st}}}var ot=d.alternate;if(ot!==null){var at=ot.child;if(at!==null){ot.child=null;do{var lt=at.sibling;at.sibling=null,at=lt}while(at!==null)}}V=d}}if(d.subtreeFlags&2064&&g!==null)g.return=d,V=g;else e:for(;V!==null;){if(d=V,d.flags&2048)switch(d.tag){case 0:case 11:case 15:Qj(9,d,d.return)}var _e=d.sibling;if(_e!==null){_e.return=d.return,V=_e;break e}V=d.return}}var it=s.current;for(V=it;V!==null;){g=V;var nt=g.child;if(g.subtreeFlags&2064&&nt!==null)nt.return=g,V=nt;else e:for(g=it;V!==null;){if(_=V,_.flags&2048)try{switch(_.tag){case 0:case 11:case 15:Rj(9,_)}}catch(ht){W(_,_.return,ht)}if(_===g){V=null;break e}var ct=_.sibling;if(ct!==null){ct.return=_.return,V=ct;break e}V=_.return}}if(K=c,jg(),lc&&typeof lc.onPostCommitFiberRoot=="function")try{lc.onPostCommitFiberRoot(kc,s)}catch{}o=!0}return o}finally{C=a,pk.transition=e}}return!1}function Yk(s,e,a){e=Ki(a,e),e=Oi(s,e,1),s=dh(s,e,1),e=L(),s!==null&&(Ac(s,1,e),Ek(s,e))}function W(s,e,a){if(s.tag===3)Yk(s,s,a);else for(;e!==null;){if(e.tag===3){Yk(e,s,a);break}else if(e.tag===1){var o=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof o.componentDidCatch=="function"&&(Si===null||!Si.has(o))){s=Ki(a,s),s=Ri(e,s,1),e=dh(e,s,1),s=L(),e!==null&&(Ac(e,1,s),Ek(e,s));break}}e=e.return}}function Ui(s,e,a){var o=s.pingCache;o!==null&&o.delete(e),e=L(),s.pingedLanes|=s.suspendedLanes&a,R===s&&(Z&a)===a&&(T===4||T===3&&(Z&130023424)===Z&&500>B()-gk?Lk(s,0):sk|=a),Ek(s,e)}function Zk(s,e){e===0&&(s.mode&1?(e=sc,sc<<=1,!(sc&130023424)&&(sc=4194304)):e=1);var a=L();s=Zg(s,e),s!==null&&(Ac(s,e,a),Ek(s,a))}function vj(s){var e=s.memoizedState,a=0;e!==null&&(a=e.retryLane),Zk(s,a)}function ck(s,e){var a=0;switch(s.tag){case 13:var o=s.stateNode,c=s.memoizedState;c!==null&&(a=c.retryLane);break;case 19:o=s.stateNode;break;default:throw Error(p(314))}o!==null&&o.delete(e),Zk(s,a)}var Wk;Wk=function(s,e,a){if(s!==null)if(s.memoizedProps!==e.pendingProps||Wf.current)Ug=!0;else{if(!(s.lanes&a)&&!(e.flags&128))return Ug=!1,zj(s,e,a);Ug=!!(s.flags&131072)}else Ug=!1,I&&e.flags&1048576&&ug(e,ng,e.index);switch(e.lanes=0,e.tag){case 2:var o=e.type;jj(s,e),s=e.pendingProps;var c=Yf(e,H.current);Tg(e,a),c=Xh(null,e,o,s,c,a);var d=bi();return e.flags|=1,typeof c=="object"&&c!==null&&typeof c.render=="function"&&c.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,Zf(o)?(d=!0,cg(e)):d=!1,e.memoizedState=c.state!==null&&c.state!==void 0?c.state:null,ah(e),c.updater=nh,e.stateNode=c,c._reactInternals=e,rh(e,o,s,a),e=kj(null,e,o,!0,d,a)):(e.tag=0,I&&d&&vg(e),Yi(null,e,c,a),e=e.child),e;case 16:o=e.elementType;e:{switch(jj(s,e),s=e.pendingProps,c=o._init,o=c(o._payload),e.type=o,c=e.tag=$k(o),s=Lg(o,s),c){case 0:e=dj(null,e,o,s,a);break e;case 1:e=ij(null,e,o,s,a);break e;case 11:e=Zi(null,e,o,s,a);break e;case 14:e=aj(null,e,o,Lg(o.type,s),a);break e}throw Error(p(306,o,""))}return e;case 0:return o=e.type,c=e.pendingProps,c=e.elementType===o?c:Lg(o,c),dj(s,e,o,c,a);case 1:return o=e.type,c=e.pendingProps,c=e.elementType===o?c:Lg(o,c),ij(s,e,o,c,a);case 3:e:{if(lj(e),s===null)throw Error(p(387));o=e.pendingProps,d=e.memoizedState,c=d.element,bh(s,e),gh(e,o,null,a);var g=e.memoizedState;if(o=g.element,d.isDehydrated)if(d={element:o,isDehydrated:!1,cache:g.cache,pendingSuspenseBoundaries:g.pendingSuspenseBoundaries,transitions:g.transitions},e.updateQueue.baseState=d,e.memoizedState=d,e.flags&256){c=Ki(Error(p(423)),e),e=mj(s,e,o,a,c);break e}else if(o!==c){c=Ki(Error(p(424)),e),e=mj(s,e,o,a,c);break e}else for(yg=Lf(e.stateNode.containerInfo.firstChild),xg=e,I=!0,zg=null,a=Ch(e,null,o,a),e.child=a;a;)a.flags=a.flags&-3|4096,a=a.sibling;else{if(Ig(),o===c){e=$i(s,e,a);break e}Yi(s,e,o,a)}e=e.child}return e;case 5:return Kh(e),s===null&&Eg(e),o=e.type,c=e.pendingProps,d=s!==null?s.memoizedProps:null,g=c.children,Ef(o,c)?g=null:d!==null&&Ef(o,d)&&(e.flags|=32),hj(s,e),Yi(s,e,g,a),e.child;case 6:return s===null&&Eg(e),null;case 13:return pj(s,e,a);case 4:return Ih(e,e.stateNode.containerInfo),o=e.pendingProps,s===null?e.child=Bh(e,null,o,a):Yi(s,e,o,a),e.child;case 11:return o=e.type,c=e.pendingProps,c=e.elementType===o?c:Lg(o,c),Zi(s,e,o,c,a);case 7:return Yi(s,e,e.pendingProps,a),e.child;case 8:return Yi(s,e,e.pendingProps.children,a),e.child;case 12:return Yi(s,e,e.pendingProps.children,a),e.child;case 10:e:{if(o=e.type._context,c=e.pendingProps,d=e.memoizedProps,g=c.value,G(Mg,o._currentValue),o._currentValue=g,d!==null)if(He(d.value,g)){if(d.children===c.children&&!Wf.current){e=$i(s,e,a);break e}}else for(d=e.child,d!==null&&(d.return=e);d!==null;){var _=d.dependencies;if(_!==null){g=d.child;for(var b=_.firstContext;b!==null;){if(b.context===o){if(d.tag===1){b=ch(-1,a&-a),b.tag=2;var $=d.updateQueue;if($!==null){$=$.shared;var tt=$.pending;tt===null?b.next=b:(b.next=tt.next,tt.next=b),$.pending=b}}d.lanes|=a,b=d.alternate,b!==null&&(b.lanes|=a),Sg(d.return,a,e),_.lanes|=a;break}b=b.next}}else if(d.tag===10)g=d.type===e.type?null:d.child;else if(d.tag===18){if(g=d.return,g===null)throw Error(p(341));g.lanes|=a,_=g.alternate,_!==null&&(_.lanes|=a),Sg(g,a,e),g=d.sibling}else g=d.child;if(g!==null)g.return=d;else for(g=d;g!==null;){if(g===e){g=null;break}if(d=g.sibling,d!==null){d.return=g.return,g=d;break}g=g.return}d=g}Yi(s,e,c.children,a),e=e.child}return e;case 9:return c=e.type,o=e.pendingProps.children,Tg(e,a),c=Vg(c),o=o(c),e.flags|=1,Yi(s,e,o,a),e.child;case 14:return o=e.type,c=Lg(o,e.pendingProps),c=Lg(o.type,c),aj(s,e,o,c,a);case 15:return cj(s,e,e.type,e.pendingProps,a);case 17:return o=e.type,c=e.pendingProps,c=e.elementType===o?c:Lg(o,c),jj(s,e),e.tag=1,Zf(o)?(s=!0,cg(e)):s=!1,Tg(e,a),ph(e,o,c),rh(e,o,c,a),kj(null,e,o,!0,s,a);case 19:return yj(s,e,a);case 22:return ej(s,e,a)}throw Error(p(156,e.tag))};function Gk(s,e){return ac(s,e)}function al(s,e,a,o){this.tag=s,this.key=a,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=o,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Bg(s,e,a,o){return new al(s,e,a,o)}function bj(s){return s=s.prototype,!(!s||!s.isReactComponent)}function $k(s){if(typeof s=="function")return bj(s)?1:0;if(s!=null){if(s=s.$$typeof,s===Da)return 11;if(s===Ga)return 14}return 2}function wh(s,e){var a=s.alternate;return a===null?(a=Bg(s.tag,e,s.key,s.mode),a.elementType=s.elementType,a.type=s.type,a.stateNode=s.stateNode,a.alternate=s,s.alternate=a):(a.pendingProps=e,a.type=s.type,a.flags=0,a.subtreeFlags=0,a.deletions=null),a.flags=s.flags&14680064,a.childLanes=s.childLanes,a.lanes=s.lanes,a.child=s.child,a.memoizedProps=s.memoizedProps,a.memoizedState=s.memoizedState,a.updateQueue=s.updateQueue,e=s.dependencies,a.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},a.sibling=s.sibling,a.index=s.index,a.ref=s.ref,a}function yh(s,e,a,o,c,d){var g=2;if(o=s,typeof s=="function")bj(s)&&(g=1);else if(typeof s=="string")g=5;else e:switch(s){case ya:return Ah(a.children,c,d,e);case za:g=8,c|=8;break;case Aa:return s=Bg(12,a,e,c|2),s.elementType=Aa,s.lanes=d,s;case Ea:return s=Bg(13,a,e,c),s.elementType=Ea,s.lanes=d,s;case Fa:return s=Bg(19,a,e,c),s.elementType=Fa,s.lanes=d,s;case Ia:return qj(a,c,d,e);default:if(typeof s=="object"&&s!==null)switch(s.$$typeof){case Ba:g=10;break e;case Ca:g=9;break e;case Da:g=11;break e;case Ga:g=14;break e;case Ha:g=16,o=null;break e}throw Error(p(130,s==null?s:typeof s,""))}return e=Bg(g,a,e,c),e.elementType=s,e.type=o,e.lanes=d,e}function Ah(s,e,a,o){return s=Bg(7,s,o,e),s.lanes=a,s}function qj(s,e,a,o){return s=Bg(22,s,o,e),s.elementType=Ia,s.lanes=a,s.stateNode={isHidden:!1},s}function xh(s,e,a){return s=Bg(6,s,null,e),s.lanes=a,s}function zh(s,e,a){return e=Bg(4,s.children!==null?s.children:[],s.key,e),e.lanes=a,e.stateNode={containerInfo:s.containerInfo,pendingChildren:null,implementation:s.implementation},e}function bl(s,e,a,o,c){this.tag=e,this.containerInfo=s,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=zc(0),this.expirationTimes=zc(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=zc(0),this.identifierPrefix=o,this.onRecoverableError=c,this.mutableSourceEagerHydrationData=null}function cl(s,e,a,o,c,d,g,_,b){return s=new bl(s,e,a,_,b),e===1?(e=1,d===!0&&(e|=8)):e=0,d=Bg(3,null,null,e),s.current=d,d.stateNode=s,d.memoizedState={element:o,isDehydrated:a,cache:null,transitions:null,pendingSuspenseBoundaries:null},ah(d),s}function dl(s,e,a){var o=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:wa,key:o==null?null:""+o,children:s,containerInfo:e,implementation:a}}function el(s){if(!s)return Vf;s=s._reactInternals;e:{if(Vb(s)!==s||s.tag!==1)throw Error(p(170));var e=s;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(Zf(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(p(171))}if(s.tag===1){var a=s.type;if(Zf(a))return bg(s,a,e)}return e}function fl(s,e,a,o,c,d,g,_,b){return s=cl(a,o,!0,s,c,d,g,_,b),s.context=el(null),a=s.current,o=L(),c=lh(a),d=ch(o,c),d.callback=e??null,dh(a,d,c),s.current.lanes=c,Ac(s,c,o),Ek(s,o),s}function gl(s,e,a,o){var c=e.current,d=L(),g=lh(c);return a=el(a),e.context===null?e.context=a:e.pendingContext=a,e=ch(d,g),e.payload={element:s},o=o===void 0?null:o,o!==null&&(e.callback=o),s=dh(c,e,g),s!==null&&(mh(s,c,g,d),eh(s,c,g)),g}function hl(s){if(s=s.current,!s.child)return null;switch(s.child.tag){case 5:return s.child.stateNode;default:return s.child.stateNode}}function il(s,e){if(s=s.memoizedState,s!==null&&s.dehydrated!==null){var a=s.retryLane;s.retryLane=a!==0&&a<e?a:e}}function jl(s,e){il(s,e),(s=s.alternate)&&il(s,e)}function kl(){return null}var ll=typeof reportError=="function"?reportError:function(s){console.error(s)};function ml(s){this._internalRoot=s}nl.prototype.render=ml.prototype.render=function(s){var e=this._internalRoot;if(e===null)throw Error(p(409));gl(s,e,null,null)};nl.prototype.unmount=ml.prototype.unmount=function(){var s=this._internalRoot;if(s!==null){this._internalRoot=null;var e=s.containerInfo;Sk(function(){gl(null,s,null,null)}),e[uf]=null}};function nl(s){this._internalRoot=s}nl.prototype.unstable_scheduleHydration=function(s){if(s){var e=Hc();s={blockedOn:null,target:s,priority:e};for(var a=0;a<Qc.length&&e!==0&&e<Qc[a].priority;a++);Qc.splice(a,0,s),a===0&&Vc(s)}};function ol(s){return!(!s||s.nodeType!==1&&s.nodeType!==9&&s.nodeType!==11)}function pl(s){return!(!s||s.nodeType!==1&&s.nodeType!==9&&s.nodeType!==11&&(s.nodeType!==8||s.nodeValue!==" react-mount-point-unstable "))}function ql(){}function rl(s,e,a,o,c){if(c){if(typeof o=="function"){var d=o;o=function(){var $=hl(g);d.call($)}}var g=fl(e,o,s,0,null,!1,!1,"",ql);return s._reactRootContainer=g,s[uf]=g.current,sf(s.nodeType===8?s.parentNode:s),Sk(),g}for(;c=s.lastChild;)s.removeChild(c);if(typeof o=="function"){var _=o;o=function(){var $=hl(b);_.call($)}}var b=cl(s,0,!1,null,null,!1,!1,"",ql);return s._reactRootContainer=b,s[uf]=b.current,sf(s.nodeType===8?s.parentNode:s),Sk(function(){gl(e,b,a,o)}),b}function sl(s,e,a,o,c){var d=a._reactRootContainer;if(d){var g=d;if(typeof c=="function"){var _=c;c=function(){var b=hl(g);_.call(b)}}gl(e,g,s,c)}else g=rl(a,e,s,c,o);return hl(g)}Ec=function(s){switch(s.tag){case 3:var e=s.stateNode;if(e.current.memoizedState.isDehydrated){var a=tc(e.pendingLanes);a!==0&&(Cc(e,a|1),Ek(e,B()),!(K&6)&&(Hj=B()+500,jg()))}break;case 13:Sk(function(){var o=Zg(s,1);if(o!==null){var c=L();mh(o,s,1,c)}}),jl(s,1)}};Fc=function(s){if(s.tag===13){var e=Zg(s,134217728);if(e!==null){var a=L();mh(e,s,134217728,a)}jl(s,134217728)}};Gc=function(s){if(s.tag===13){var e=lh(s),a=Zg(s,e);if(a!==null){var o=L();mh(a,s,e,o)}jl(s,e)}};Hc=function(){return C};Ic=function(s,e){var a=C;try{return C=s,e()}finally{C=a}};yb=function(s,e,a){switch(e){case"input":if(bb(s,a),e=a.name,a.type==="radio"&&e!=null){for(a=s;a.parentNode;)a=a.parentNode;for(a=a.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<a.length;e++){var o=a[e];if(o!==s&&o.form===s.form){var c=Db(o);if(!c)throw Error(p(90));Wa(o),bb(o,c)}}}break;case"textarea":ib(s,a);break;case"select":e=a.value,e!=null&&fb(s,!!a.multiple,e,!1)}};Gb=Rk;Hb=Sk;var tl={usingClientEntryPoint:!1,Events:[Cb,ue,Db,Eb,Fb,Rk]},ul={findFiberByHostInstance:Wc,bundleType:0,version:"18.2.0",rendererPackageName:"react-dom"},vl={bundleType:ul.bundleType,version:ul.version,rendererPackageName:ul.rendererPackageName,rendererConfig:ul.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:ua.ReactCurrentDispatcher,findHostInstanceByFiber:function(s){return s=Zb(s),s===null?null:s.stateNode},findFiberByHostInstance:ul.findFiberByHostInstance||kl,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.2.0-next-9e3b772b8-20220608"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"){var wl=__REACT_DEVTOOLS_GLOBAL_HOOK__;if(!wl.isDisabled&&wl.supportsFiber)try{kc=wl.inject(vl),lc=wl}catch{}}reactDom_production_min.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=tl;reactDom_production_min.createPortal=function(s,e){var a=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!ol(e))throw Error(p(200));return dl(s,e,null,a)};reactDom_production_min.createRoot=function(s,e){if(!ol(s))throw Error(p(299));var a=!1,o="",c=ll;return e!=null&&(e.unstable_strictMode===!0&&(a=!0),e.identifierPrefix!==void 0&&(o=e.identifierPrefix),e.onRecoverableError!==void 0&&(c=e.onRecoverableError)),e=cl(s,1,!1,null,null,a,!1,o,c),s[uf]=e.current,sf(s.nodeType===8?s.parentNode:s),new ml(e)};reactDom_production_min.findDOMNode=function(s){if(s==null)return null;if(s.nodeType===1)return s;var e=s._reactInternals;if(e===void 0)throw typeof s.render=="function"?Error(p(188)):(s=Object.keys(s).join(","),Error(p(268,s)));return s=Zb(e),s=s===null?null:s.stateNode,s};reactDom_production_min.flushSync=function(s){return Sk(s)};reactDom_production_min.hydrate=function(s,e,a){if(!pl(e))throw Error(p(200));return sl(null,s,e,!0,a)};reactDom_production_min.hydrateRoot=function(s,e,a){if(!ol(s))throw Error(p(405));var o=a!=null&&a.hydratedSources||null,c=!1,d="",g=ll;if(a!=null&&(a.unstable_strictMode===!0&&(c=!0),a.identifierPrefix!==void 0&&(d=a.identifierPrefix),a.onRecoverableError!==void 0&&(g=a.onRecoverableError)),e=fl(e,null,s,1,a??null,c,!1,d,g),s[uf]=e.current,sf(s),o)for(s=0;s<o.length;s++)a=o[s],c=a._getVersion,c=c(a._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[a,c]:e.mutableSourceEagerHydrationData.push(a,c);return new nl(e)};reactDom_production_min.render=function(s,e,a){if(!pl(e))throw Error(p(200));return sl(null,s,e,!1,a)};reactDom_production_min.unmountComponentAtNode=function(s){if(!pl(s))throw Error(p(40));return s._reactRootContainer?(Sk(function(){sl(null,null,s,!1,function(){s._reactRootContainer=null,s[uf]=null})}),!0):!1};reactDom_production_min.unstable_batchedUpdates=Rk;reactDom_production_min.unstable_renderSubtreeIntoContainer=function(s,e,a,o){if(!pl(a))throw Error(p(200));if(s==null||s._reactInternals===void 0)throw Error(p(38));return sl(s,e,a,!1,o)};reactDom_production_min.version="18.2.0-next-9e3b772b8-20220608";function checkDCE(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE)}catch(s){console.error(s)}}checkDCE(),reactDom.exports=reactDom_production_min;var reactDomExports=reactDom.exports,m=reactDomExports;client.createRoot=m.createRoot,client.hydrateRoot=m.hydrateRoot;/**
 * @license
 * Copyright 2010-2023 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const REVISION="163",MOUSE={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},TOUCH={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},CullFaceNone=0,CullFaceBack=1,CullFaceFront=2,PCFShadowMap=1,PCFSoftShadowMap=2,VSMShadowMap=3,FrontSide=0,BackSide=1,DoubleSide=2,NoBlending=0,NormalBlending=1,AdditiveBlending=2,SubtractiveBlending=3,MultiplyBlending=4,CustomBlending=5,AddEquation=100,SubtractEquation=101,ReverseSubtractEquation=102,MinEquation=103,MaxEquation=104,ZeroFactor=200,OneFactor=201,SrcColorFactor=202,OneMinusSrcColorFactor=203,SrcAlphaFactor=204,OneMinusSrcAlphaFactor=205,DstAlphaFactor=206,OneMinusDstAlphaFactor=207,DstColorFactor=208,OneMinusDstColorFactor=209,SrcAlphaSaturateFactor=210,ConstantColorFactor=211,OneMinusConstantColorFactor=212,ConstantAlphaFactor=213,OneMinusConstantAlphaFactor=214,NeverDepth=0,AlwaysDepth=1,LessDepth=2,LessEqualDepth=3,EqualDepth=4,GreaterEqualDepth=5,GreaterDepth=6,NotEqualDepth=7,MultiplyOperation=0,MixOperation=1,AddOperation=2,NoToneMapping=0,LinearToneMapping=1,ReinhardToneMapping=2,CineonToneMapping=3,ACESFilmicToneMapping=4,CustomToneMapping=5,AgXToneMapping=6,NeutralToneMapping=7,UVMapping=300,CubeReflectionMapping=301,CubeRefractionMapping=302,EquirectangularReflectionMapping=303,EquirectangularRefractionMapping=304,CubeUVReflectionMapping=306,RepeatWrapping=1e3,ClampToEdgeWrapping=1001,MirroredRepeatWrapping=1002,NearestFilter=1003,NearestMipmapNearestFilter=1004,NearestMipmapLinearFilter=1005,LinearFilter=1006,LinearMipmapNearestFilter=1007,LinearMipmapLinearFilter=1008,UnsignedByteType=1009,ByteType=1010,ShortType=1011,UnsignedShortType=1012,IntType=1013,UnsignedIntType=1014,FloatType=1015,HalfFloatType=1016,UnsignedShort4444Type=1017,UnsignedShort5551Type=1018,UnsignedInt248Type=1020,UnsignedInt5999Type=35902,AlphaFormat=1021,RGBFormat=1022,RGBAFormat=1023,LuminanceFormat=1024,LuminanceAlphaFormat=1025,DepthFormat=1026,DepthStencilFormat=1027,RedFormat=1028,RedIntegerFormat=1029,RGFormat=1030,RGIntegerFormat=1031,RGBAIntegerFormat=1033,RGB_S3TC_DXT1_Format=33776,RGBA_S3TC_DXT1_Format=33777,RGBA_S3TC_DXT3_Format=33778,RGBA_S3TC_DXT5_Format=33779,RGB_PVRTC_4BPPV1_Format=35840,RGB_PVRTC_2BPPV1_Format=35841,RGBA_PVRTC_4BPPV1_Format=35842,RGBA_PVRTC_2BPPV1_Format=35843,RGB_ETC1_Format=36196,RGB_ETC2_Format=37492,RGBA_ETC2_EAC_Format=37496,RGBA_ASTC_4x4_Format=37808,RGBA_ASTC_5x4_Format=37809,RGBA_ASTC_5x5_Format=37810,RGBA_ASTC_6x5_Format=37811,RGBA_ASTC_6x6_Format=37812,RGBA_ASTC_8x5_Format=37813,RGBA_ASTC_8x6_Format=37814,RGBA_ASTC_8x8_Format=37815,RGBA_ASTC_10x5_Format=37816,RGBA_ASTC_10x6_Format=37817,RGBA_ASTC_10x8_Format=37818,RGBA_ASTC_10x10_Format=37819,RGBA_ASTC_12x10_Format=37820,RGBA_ASTC_12x12_Format=37821,RGBA_BPTC_Format=36492,RGB_BPTC_SIGNED_Format=36494,RGB_BPTC_UNSIGNED_Format=36495,RED_RGTC1_Format=36283,SIGNED_RED_RGTC1_Format=36284,RED_GREEN_RGTC2_Format=36285,SIGNED_RED_GREEN_RGTC2_Format=36286,BasicDepthPacking=3200,RGBADepthPacking=3201,TangentSpaceNormalMap=0,ObjectSpaceNormalMap=1,NoColorSpace="",SRGBColorSpace="srgb",LinearSRGBColorSpace="srgb-linear",DisplayP3ColorSpace="display-p3",LinearDisplayP3ColorSpace="display-p3-linear",LinearTransfer="linear",SRGBTransfer="srgb",Rec709Primaries="rec709",P3Primaries="p3",KeepStencilOp=7680,AlwaysStencilFunc=519,NeverCompare=512,LessCompare=513,EqualCompare=514,LessEqualCompare=515,GreaterCompare=516,NotEqualCompare=517,GreaterEqualCompare=518,AlwaysCompare=519,StaticDrawUsage=35044,GLSL3="300 es",WebGLCoordinateSystem=2e3,WebGPUCoordinateSystem=2001;class EventDispatcher{addEventListener(e,a){this._listeners===void 0&&(this._listeners={});const o=this._listeners;o[e]===void 0&&(o[e]=[]),o[e].indexOf(a)===-1&&o[e].push(a)}hasEventListener(e,a){if(this._listeners===void 0)return!1;const o=this._listeners;return o[e]!==void 0&&o[e].indexOf(a)!==-1}removeEventListener(e,a){if(this._listeners===void 0)return;const c=this._listeners[e];if(c!==void 0){const d=c.indexOf(a);d!==-1&&c.splice(d,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const o=this._listeners[e.type];if(o!==void 0){e.target=this;const c=o.slice(0);for(let d=0,g=c.length;d<g;d++)c[d].call(this,e);e.target=null}}}const _lut=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let _seed=1234567;const DEG2RAD=Math.PI/180,RAD2DEG=180/Math.PI;function generateUUID(){const s=Math.random()*4294967295|0,e=Math.random()*4294967295|0,a=Math.random()*4294967295|0,o=Math.random()*4294967295|0;return(_lut[s&255]+_lut[s>>8&255]+_lut[s>>16&255]+_lut[s>>24&255]+"-"+_lut[e&255]+_lut[e>>8&255]+"-"+_lut[e>>16&15|64]+_lut[e>>24&255]+"-"+_lut[a&63|128]+_lut[a>>8&255]+"-"+_lut[a>>16&255]+_lut[a>>24&255]+_lut[o&255]+_lut[o>>8&255]+_lut[o>>16&255]+_lut[o>>24&255]).toLowerCase()}function clamp(s,e,a){return Math.max(e,Math.min(a,s))}function euclideanModulo(s,e){return(s%e+e)%e}function mapLinear(s,e,a,o,c){return o+(s-e)*(c-o)/(a-e)}function inverseLerp(s,e,a){return s!==e?(a-s)/(e-s):0}function lerp(s,e,a){return(1-a)*s+a*e}function damp(s,e,a,o){return lerp(s,e,1-Math.exp(-a*o))}function pingpong(s,e=1){return e-Math.abs(euclideanModulo(s,e*2)-e)}function smoothstep(s,e,a){return s<=e?0:s>=a?1:(s=(s-e)/(a-e),s*s*(3-2*s))}function smootherstep(s,e,a){return s<=e?0:s>=a?1:(s=(s-e)/(a-e),s*s*s*(s*(s*6-15)+10))}function randInt(s,e){return s+Math.floor(Math.random()*(e-s+1))}function randFloat(s,e){return s+Math.random()*(e-s)}function randFloatSpread(s){return s*(.5-Math.random())}function seededRandom(s){s!==void 0&&(_seed=s);let e=_seed+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function degToRad(s){return s*DEG2RAD}function radToDeg(s){return s*RAD2DEG}function isPowerOfTwo(s){return(s&s-1)===0&&s!==0}function ceilPowerOfTwo(s){return Math.pow(2,Math.ceil(Math.log(s)/Math.LN2))}function floorPowerOfTwo(s){return Math.pow(2,Math.floor(Math.log(s)/Math.LN2))}function setQuaternionFromProperEuler(s,e,a,o,c){const d=Math.cos,g=Math.sin,_=d(a/2),b=g(a/2),$=d((e+o)/2),tt=g((e+o)/2),rt=d((e-o)/2),et=g((e-o)/2),st=d((o-e)/2),ot=g((o-e)/2);switch(c){case"XYX":s.set(_*tt,b*rt,b*et,_*$);break;case"YZY":s.set(b*et,_*tt,b*rt,_*$);break;case"ZXZ":s.set(b*rt,b*et,_*tt,_*$);break;case"XZX":s.set(_*tt,b*ot,b*st,_*$);break;case"YXY":s.set(b*st,_*tt,b*ot,_*$);break;case"ZYZ":s.set(b*ot,b*st,_*tt,_*$);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+c)}}function denormalize(s,e){switch(e.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("Invalid component type.")}}function normalize(s,e){switch(e.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("Invalid component type.")}}const MathUtils={DEG2RAD,RAD2DEG,generateUUID,clamp,euclideanModulo,mapLinear,inverseLerp,lerp,damp,pingpong,smoothstep,smootherstep,randInt,randFloat,randFloatSpread,seededRandom,degToRad,radToDeg,isPowerOfTwo,ceilPowerOfTwo,floorPowerOfTwo,setQuaternionFromProperEuler,normalize,denormalize};class Vector2{constructor(e=0,a=0){Vector2.prototype.isVector2=!0,this.x=e,this.y=a}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,a){return this.x=e,this.y=a,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,a){switch(e){case 0:this.x=a;break;case 1:this.y=a;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,a){return this.x=e.x+a.x,this.y=e.y+a.y,this}addScaledVector(e,a){return this.x+=e.x*a,this.y+=e.y*a,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,a){return this.x=e.x-a.x,this.y=e.y-a.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const a=this.x,o=this.y,c=e.elements;return this.x=c[0]*a+c[3]*o+c[6],this.y=c[1]*a+c[4]*o+c[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,a){return this.x=Math.max(e.x,Math.min(a.x,this.x)),this.y=Math.max(e.y,Math.min(a.y,this.y)),this}clampScalar(e,a){return this.x=Math.max(e,Math.min(a,this.x)),this.y=Math.max(e,Math.min(a,this.y)),this}clampLength(e,a){const o=this.length();return this.divideScalar(o||1).multiplyScalar(Math.max(e,Math.min(a,o)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const a=Math.sqrt(this.lengthSq()*e.lengthSq());if(a===0)return Math.PI/2;const o=this.dot(e)/a;return Math.acos(clamp(o,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const a=this.x-e.x,o=this.y-e.y;return a*a+o*o}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,a){return this.x+=(e.x-this.x)*a,this.y+=(e.y-this.y)*a,this}lerpVectors(e,a,o){return this.x=e.x+(a.x-e.x)*o,this.y=e.y+(a.y-e.y)*o,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,a=0){return this.x=e[a],this.y=e[a+1],this}toArray(e=[],a=0){return e[a]=this.x,e[a+1]=this.y,e}fromBufferAttribute(e,a){return this.x=e.getX(a),this.y=e.getY(a),this}rotateAround(e,a){const o=Math.cos(a),c=Math.sin(a),d=this.x-e.x,g=this.y-e.y;return this.x=d*o-g*c+e.x,this.y=d*c+g*o+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Matrix3{constructor(e,a,o,c,d,g,_,b,$){Matrix3.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,a,o,c,d,g,_,b,$)}set(e,a,o,c,d,g,_,b,$){const tt=this.elements;return tt[0]=e,tt[1]=c,tt[2]=_,tt[3]=a,tt[4]=d,tt[5]=b,tt[6]=o,tt[7]=g,tt[8]=$,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const a=this.elements,o=e.elements;return a[0]=o[0],a[1]=o[1],a[2]=o[2],a[3]=o[3],a[4]=o[4],a[5]=o[5],a[6]=o[6],a[7]=o[7],a[8]=o[8],this}extractBasis(e,a,o){return e.setFromMatrix3Column(this,0),a.setFromMatrix3Column(this,1),o.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const a=e.elements;return this.set(a[0],a[4],a[8],a[1],a[5],a[9],a[2],a[6],a[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,a){const o=e.elements,c=a.elements,d=this.elements,g=o[0],_=o[3],b=o[6],$=o[1],tt=o[4],rt=o[7],et=o[2],st=o[5],ot=o[8],at=c[0],lt=c[3],_e=c[6],it=c[1],nt=c[4],ct=c[7],ht=c[2],ft=c[5],pt=c[8];return d[0]=g*at+_*it+b*ht,d[3]=g*lt+_*nt+b*ft,d[6]=g*_e+_*ct+b*pt,d[1]=$*at+tt*it+rt*ht,d[4]=$*lt+tt*nt+rt*ft,d[7]=$*_e+tt*ct+rt*pt,d[2]=et*at+st*it+ot*ht,d[5]=et*lt+st*nt+ot*ft,d[8]=et*_e+st*ct+ot*pt,this}multiplyScalar(e){const a=this.elements;return a[0]*=e,a[3]*=e,a[6]*=e,a[1]*=e,a[4]*=e,a[7]*=e,a[2]*=e,a[5]*=e,a[8]*=e,this}determinant(){const e=this.elements,a=e[0],o=e[1],c=e[2],d=e[3],g=e[4],_=e[5],b=e[6],$=e[7],tt=e[8];return a*g*tt-a*_*$-o*d*tt+o*_*b+c*d*$-c*g*b}invert(){const e=this.elements,a=e[0],o=e[1],c=e[2],d=e[3],g=e[4],_=e[5],b=e[6],$=e[7],tt=e[8],rt=tt*g-_*$,et=_*b-tt*d,st=$*d-g*b,ot=a*rt+o*et+c*st;if(ot===0)return this.set(0,0,0,0,0,0,0,0,0);const at=1/ot;return e[0]=rt*at,e[1]=(c*$-tt*o)*at,e[2]=(_*o-c*g)*at,e[3]=et*at,e[4]=(tt*a-c*b)*at,e[5]=(c*d-_*a)*at,e[6]=st*at,e[7]=(o*b-$*a)*at,e[8]=(g*a-o*d)*at,this}transpose(){let e;const a=this.elements;return e=a[1],a[1]=a[3],a[3]=e,e=a[2],a[2]=a[6],a[6]=e,e=a[5],a[5]=a[7],a[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const a=this.elements;return e[0]=a[0],e[1]=a[3],e[2]=a[6],e[3]=a[1],e[4]=a[4],e[5]=a[7],e[6]=a[2],e[7]=a[5],e[8]=a[8],this}setUvTransform(e,a,o,c,d,g,_){const b=Math.cos(d),$=Math.sin(d);return this.set(o*b,o*$,-o*(b*g+$*_)+g+e,-c*$,c*b,-c*(-$*g+b*_)+_+a,0,0,1),this}scale(e,a){return this.premultiply(_m3.makeScale(e,a)),this}rotate(e){return this.premultiply(_m3.makeRotation(-e)),this}translate(e,a){return this.premultiply(_m3.makeTranslation(e,a)),this}makeTranslation(e,a){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,a,0,0,1),this}makeRotation(e){const a=Math.cos(e),o=Math.sin(e);return this.set(a,-o,0,o,a,0,0,0,1),this}makeScale(e,a){return this.set(e,0,0,0,a,0,0,0,1),this}equals(e){const a=this.elements,o=e.elements;for(let c=0;c<9;c++)if(a[c]!==o[c])return!1;return!0}fromArray(e,a=0){for(let o=0;o<9;o++)this.elements[o]=e[o+a];return this}toArray(e=[],a=0){const o=this.elements;return e[a]=o[0],e[a+1]=o[1],e[a+2]=o[2],e[a+3]=o[3],e[a+4]=o[4],e[a+5]=o[5],e[a+6]=o[6],e[a+7]=o[7],e[a+8]=o[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const _m3=new Matrix3;function arrayNeedsUint32(s){for(let e=s.length-1;e>=0;--e)if(s[e]>=65535)return!0;return!1}function createElementNS(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function createCanvasElement(){const s=createElementNS("canvas");return s.style.display="block",s}const _cache={};function warnOnce(s){s in _cache||(_cache[s]=!0,console.warn(s))}const LINEAR_SRGB_TO_LINEAR_DISPLAY_P3=new Matrix3().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),LINEAR_DISPLAY_P3_TO_LINEAR_SRGB=new Matrix3().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),COLOR_SPACES={[LinearSRGBColorSpace]:{transfer:LinearTransfer,primaries:Rec709Primaries,toReference:s=>s,fromReference:s=>s},[SRGBColorSpace]:{transfer:SRGBTransfer,primaries:Rec709Primaries,toReference:s=>s.convertSRGBToLinear(),fromReference:s=>s.convertLinearToSRGB()},[LinearDisplayP3ColorSpace]:{transfer:LinearTransfer,primaries:P3Primaries,toReference:s=>s.applyMatrix3(LINEAR_DISPLAY_P3_TO_LINEAR_SRGB),fromReference:s=>s.applyMatrix3(LINEAR_SRGB_TO_LINEAR_DISPLAY_P3)},[DisplayP3ColorSpace]:{transfer:SRGBTransfer,primaries:P3Primaries,toReference:s=>s.convertSRGBToLinear().applyMatrix3(LINEAR_DISPLAY_P3_TO_LINEAR_SRGB),fromReference:s=>s.applyMatrix3(LINEAR_SRGB_TO_LINEAR_DISPLAY_P3).convertLinearToSRGB()}},SUPPORTED_WORKING_COLOR_SPACES=new Set([LinearSRGBColorSpace,LinearDisplayP3ColorSpace]),ColorManagement={enabled:!0,_workingColorSpace:LinearSRGBColorSpace,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(s){if(!SUPPORTED_WORKING_COLOR_SPACES.has(s))throw new Error(`Unsupported working color space, "${s}".`);this._workingColorSpace=s},convert:function(s,e,a){if(this.enabled===!1||e===a||!e||!a)return s;const o=COLOR_SPACES[e].toReference,c=COLOR_SPACES[a].fromReference;return c(o(s))},fromWorkingColorSpace:function(s,e){return this.convert(s,this._workingColorSpace,e)},toWorkingColorSpace:function(s,e){return this.convert(s,e,this._workingColorSpace)},getPrimaries:function(s){return COLOR_SPACES[s].primaries},getTransfer:function(s){return s===NoColorSpace?LinearTransfer:COLOR_SPACES[s].transfer}};function SRGBToLinear(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function LinearToSRGB(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}let _canvas;class ImageUtils{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let a;if(e instanceof HTMLCanvasElement)a=e;else{_canvas===void 0&&(_canvas=createElementNS("canvas")),_canvas.width=e.width,_canvas.height=e.height;const o=_canvas.getContext("2d");e instanceof ImageData?o.putImageData(e,0,0):o.drawImage(e,0,0,e.width,e.height),a=_canvas}return a.width>2048||a.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),a.toDataURL("image/jpeg",.6)):a.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const a=createElementNS("canvas");a.width=e.width,a.height=e.height;const o=a.getContext("2d");o.drawImage(e,0,0,e.width,e.height);const c=o.getImageData(0,0,e.width,e.height),d=c.data;for(let g=0;g<d.length;g++)d[g]=SRGBToLinear(d[g]/255)*255;return o.putImageData(c,0,0),a}else if(e.data){const a=e.data.slice(0);for(let o=0;o<a.length;o++)a instanceof Uint8Array||a instanceof Uint8ClampedArray?a[o]=Math.floor(SRGBToLinear(a[o]/255)*255):a[o]=SRGBToLinear(a[o]);return{data:a,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let _sourceId=0;class Source{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:_sourceId++}),this.uuid=generateUUID(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const a=e===void 0||typeof e=="string";if(!a&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const o={uuid:this.uuid,url:""},c=this.data;if(c!==null){let d;if(Array.isArray(c)){d=[];for(let g=0,_=c.length;g<_;g++)c[g].isDataTexture?d.push(serializeImage(c[g].image)):d.push(serializeImage(c[g]))}else d=serializeImage(c);o.url=d}return a||(e.images[this.uuid]=o),o}}function serializeImage(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?ImageUtils.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let _textureId=0;class Texture extends EventDispatcher{constructor(e=Texture.DEFAULT_IMAGE,a=Texture.DEFAULT_MAPPING,o=ClampToEdgeWrapping,c=ClampToEdgeWrapping,d=LinearFilter,g=LinearMipmapLinearFilter,_=RGBAFormat,b=UnsignedByteType,$=Texture.DEFAULT_ANISOTROPY,tt=NoColorSpace){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:_textureId++}),this.uuid=generateUUID(),this.name="",this.source=new Source(e),this.mipmaps=[],this.mapping=a,this.channel=0,this.wrapS=o,this.wrapT=c,this.magFilter=d,this.minFilter=g,this.anisotropy=$,this.format=_,this.internalFormat=null,this.type=b,this.offset=new Vector2(0,0),this.repeat=new Vector2(1,1),this.center=new Vector2(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Matrix3,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=tt,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const a=e===void 0||typeof e=="string";if(!a&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const o={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(o.userData=this.userData),a||(e.textures[this.uuid]=o),o}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==UVMapping)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case RepeatWrapping:e.x=e.x-Math.floor(e.x);break;case ClampToEdgeWrapping:e.x=e.x<0?0:1;break;case MirroredRepeatWrapping:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case RepeatWrapping:e.y=e.y-Math.floor(e.y);break;case ClampToEdgeWrapping:e.y=e.y<0?0:1;break;case MirroredRepeatWrapping:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}Texture.DEFAULT_IMAGE=null;Texture.DEFAULT_MAPPING=UVMapping;Texture.DEFAULT_ANISOTROPY=1;class Vector4{constructor(e=0,a=0,o=0,c=1){Vector4.prototype.isVector4=!0,this.x=e,this.y=a,this.z=o,this.w=c}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,a,o,c){return this.x=e,this.y=a,this.z=o,this.w=c,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,a){switch(e){case 0:this.x=a;break;case 1:this.y=a;break;case 2:this.z=a;break;case 3:this.w=a;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,a){return this.x=e.x+a.x,this.y=e.y+a.y,this.z=e.z+a.z,this.w=e.w+a.w,this}addScaledVector(e,a){return this.x+=e.x*a,this.y+=e.y*a,this.z+=e.z*a,this.w+=e.w*a,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,a){return this.x=e.x-a.x,this.y=e.y-a.y,this.z=e.z-a.z,this.w=e.w-a.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const a=this.x,o=this.y,c=this.z,d=this.w,g=e.elements;return this.x=g[0]*a+g[4]*o+g[8]*c+g[12]*d,this.y=g[1]*a+g[5]*o+g[9]*c+g[13]*d,this.z=g[2]*a+g[6]*o+g[10]*c+g[14]*d,this.w=g[3]*a+g[7]*o+g[11]*c+g[15]*d,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const a=Math.sqrt(1-e.w*e.w);return a<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/a,this.y=e.y/a,this.z=e.z/a),this}setAxisAngleFromRotationMatrix(e){let a,o,c,d;const b=e.elements,$=b[0],tt=b[4],rt=b[8],et=b[1],st=b[5],ot=b[9],at=b[2],lt=b[6],_e=b[10];if(Math.abs(tt-et)<.01&&Math.abs(rt-at)<.01&&Math.abs(ot-lt)<.01){if(Math.abs(tt+et)<.1&&Math.abs(rt+at)<.1&&Math.abs(ot+lt)<.1&&Math.abs($+st+_e-3)<.1)return this.set(1,0,0,0),this;a=Math.PI;const nt=($+1)/2,ct=(st+1)/2,ht=(_e+1)/2,ft=(tt+et)/4,pt=(rt+at)/4,yt=(ot+lt)/4;return nt>ct&&nt>ht?nt<.01?(o=0,c=.707106781,d=.707106781):(o=Math.sqrt(nt),c=ft/o,d=pt/o):ct>ht?ct<.01?(o=.707106781,c=0,d=.707106781):(c=Math.sqrt(ct),o=ft/c,d=yt/c):ht<.01?(o=.707106781,c=.707106781,d=0):(d=Math.sqrt(ht),o=pt/d,c=yt/d),this.set(o,c,d,a),this}let it=Math.sqrt((lt-ot)*(lt-ot)+(rt-at)*(rt-at)+(et-tt)*(et-tt));return Math.abs(it)<.001&&(it=1),this.x=(lt-ot)/it,this.y=(rt-at)/it,this.z=(et-tt)/it,this.w=Math.acos(($+st+_e-1)/2),this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,a){return this.x=Math.max(e.x,Math.min(a.x,this.x)),this.y=Math.max(e.y,Math.min(a.y,this.y)),this.z=Math.max(e.z,Math.min(a.z,this.z)),this.w=Math.max(e.w,Math.min(a.w,this.w)),this}clampScalar(e,a){return this.x=Math.max(e,Math.min(a,this.x)),this.y=Math.max(e,Math.min(a,this.y)),this.z=Math.max(e,Math.min(a,this.z)),this.w=Math.max(e,Math.min(a,this.w)),this}clampLength(e,a){const o=this.length();return this.divideScalar(o||1).multiplyScalar(Math.max(e,Math.min(a,o)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,a){return this.x+=(e.x-this.x)*a,this.y+=(e.y-this.y)*a,this.z+=(e.z-this.z)*a,this.w+=(e.w-this.w)*a,this}lerpVectors(e,a,o){return this.x=e.x+(a.x-e.x)*o,this.y=e.y+(a.y-e.y)*o,this.z=e.z+(a.z-e.z)*o,this.w=e.w+(a.w-e.w)*o,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,a=0){return this.x=e[a],this.y=e[a+1],this.z=e[a+2],this.w=e[a+3],this}toArray(e=[],a=0){return e[a]=this.x,e[a+1]=this.y,e[a+2]=this.z,e[a+3]=this.w,e}fromBufferAttribute(e,a){return this.x=e.getX(a),this.y=e.getY(a),this.z=e.getZ(a),this.w=e.getW(a),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class RenderTarget extends EventDispatcher{constructor(e=1,a=1,o={}){super(),this.isRenderTarget=!0,this.width=e,this.height=a,this.depth=1,this.scissor=new Vector4(0,0,e,a),this.scissorTest=!1,this.viewport=new Vector4(0,0,e,a);const c={width:e,height:a,depth:1};o=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:LinearFilter,depthBuffer:!0,stencilBuffer:!1,depthTexture:null,samples:0,count:1},o);const d=new Texture(c,o.mapping,o.wrapS,o.wrapT,o.magFilter,o.minFilter,o.format,o.type,o.anisotropy,o.colorSpace);d.flipY=!1,d.generateMipmaps=o.generateMipmaps,d.internalFormat=o.internalFormat,this.textures=[];const g=o.count;for(let _=0;_<g;_++)this.textures[_]=d.clone(),this.textures[_].isRenderTargetTexture=!0;this.depthBuffer=o.depthBuffer,this.stencilBuffer=o.stencilBuffer,this.depthTexture=o.depthTexture,this.samples=o.samples}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}setSize(e,a,o=1){if(this.width!==e||this.height!==a||this.depth!==o){this.width=e,this.height=a,this.depth=o;for(let c=0,d=this.textures.length;c<d;c++)this.textures[c].image.width=e,this.textures[c].image.height=a,this.textures[c].image.depth=o;this.dispose()}this.viewport.set(0,0,e,a),this.scissor.set(0,0,e,a)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let o=0,c=e.textures.length;o<c;o++)this.textures[o]=e.textures[o].clone(),this.textures[o].isRenderTargetTexture=!0;const a=Object.assign({},e.texture.image);return this.texture.source=new Source(a),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class WebGLRenderTarget extends RenderTarget{constructor(e=1,a=1,o={}){super(e,a,o),this.isWebGLRenderTarget=!0}}class DataArrayTexture extends Texture{constructor(e=null,a=1,o=1,c=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:a,height:o,depth:c},this.magFilter=NearestFilter,this.minFilter=NearestFilter,this.wrapR=ClampToEdgeWrapping,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Data3DTexture extends Texture{constructor(e=null,a=1,o=1,c=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:a,height:o,depth:c},this.magFilter=NearestFilter,this.minFilter=NearestFilter,this.wrapR=ClampToEdgeWrapping,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Quaternion{constructor(e=0,a=0,o=0,c=1){this.isQuaternion=!0,this._x=e,this._y=a,this._z=o,this._w=c}static slerpFlat(e,a,o,c,d,g,_){let b=o[c+0],$=o[c+1],tt=o[c+2],rt=o[c+3];const et=d[g+0],st=d[g+1],ot=d[g+2],at=d[g+3];if(_===0){e[a+0]=b,e[a+1]=$,e[a+2]=tt,e[a+3]=rt;return}if(_===1){e[a+0]=et,e[a+1]=st,e[a+2]=ot,e[a+3]=at;return}if(rt!==at||b!==et||$!==st||tt!==ot){let lt=1-_;const _e=b*et+$*st+tt*ot+rt*at,it=_e>=0?1:-1,nt=1-_e*_e;if(nt>Number.EPSILON){const ht=Math.sqrt(nt),ft=Math.atan2(ht,_e*it);lt=Math.sin(lt*ft)/ht,_=Math.sin(_*ft)/ht}const ct=_*it;if(b=b*lt+et*ct,$=$*lt+st*ct,tt=tt*lt+ot*ct,rt=rt*lt+at*ct,lt===1-_){const ht=1/Math.sqrt(b*b+$*$+tt*tt+rt*rt);b*=ht,$*=ht,tt*=ht,rt*=ht}}e[a]=b,e[a+1]=$,e[a+2]=tt,e[a+3]=rt}static multiplyQuaternionsFlat(e,a,o,c,d,g){const _=o[c],b=o[c+1],$=o[c+2],tt=o[c+3],rt=d[g],et=d[g+1],st=d[g+2],ot=d[g+3];return e[a]=_*ot+tt*rt+b*st-$*et,e[a+1]=b*ot+tt*et+$*rt-_*st,e[a+2]=$*ot+tt*st+_*et-b*rt,e[a+3]=tt*ot-_*rt-b*et-$*st,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,a,o,c){return this._x=e,this._y=a,this._z=o,this._w=c,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,a=!0){const o=e._x,c=e._y,d=e._z,g=e._order,_=Math.cos,b=Math.sin,$=_(o/2),tt=_(c/2),rt=_(d/2),et=b(o/2),st=b(c/2),ot=b(d/2);switch(g){case"XYZ":this._x=et*tt*rt+$*st*ot,this._y=$*st*rt-et*tt*ot,this._z=$*tt*ot+et*st*rt,this._w=$*tt*rt-et*st*ot;break;case"YXZ":this._x=et*tt*rt+$*st*ot,this._y=$*st*rt-et*tt*ot,this._z=$*tt*ot-et*st*rt,this._w=$*tt*rt+et*st*ot;break;case"ZXY":this._x=et*tt*rt-$*st*ot,this._y=$*st*rt+et*tt*ot,this._z=$*tt*ot+et*st*rt,this._w=$*tt*rt-et*st*ot;break;case"ZYX":this._x=et*tt*rt-$*st*ot,this._y=$*st*rt+et*tt*ot,this._z=$*tt*ot-et*st*rt,this._w=$*tt*rt+et*st*ot;break;case"YZX":this._x=et*tt*rt+$*st*ot,this._y=$*st*rt+et*tt*ot,this._z=$*tt*ot-et*st*rt,this._w=$*tt*rt-et*st*ot;break;case"XZY":this._x=et*tt*rt-$*st*ot,this._y=$*st*rt-et*tt*ot,this._z=$*tt*ot+et*st*rt,this._w=$*tt*rt+et*st*ot;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+g)}return a===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,a){const o=a/2,c=Math.sin(o);return this._x=e.x*c,this._y=e.y*c,this._z=e.z*c,this._w=Math.cos(o),this._onChangeCallback(),this}setFromRotationMatrix(e){const a=e.elements,o=a[0],c=a[4],d=a[8],g=a[1],_=a[5],b=a[9],$=a[2],tt=a[6],rt=a[10],et=o+_+rt;if(et>0){const st=.5/Math.sqrt(et+1);this._w=.25/st,this._x=(tt-b)*st,this._y=(d-$)*st,this._z=(g-c)*st}else if(o>_&&o>rt){const st=2*Math.sqrt(1+o-_-rt);this._w=(tt-b)/st,this._x=.25*st,this._y=(c+g)/st,this._z=(d+$)/st}else if(_>rt){const st=2*Math.sqrt(1+_-o-rt);this._w=(d-$)/st,this._x=(c+g)/st,this._y=.25*st,this._z=(b+tt)/st}else{const st=2*Math.sqrt(1+rt-o-_);this._w=(g-c)/st,this._x=(d+$)/st,this._y=(b+tt)/st,this._z=.25*st}return this._onChangeCallback(),this}setFromUnitVectors(e,a){let o=e.dot(a)+1;return o<Number.EPSILON?(o=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=o):(this._x=0,this._y=-e.z,this._z=e.y,this._w=o)):(this._x=e.y*a.z-e.z*a.y,this._y=e.z*a.x-e.x*a.z,this._z=e.x*a.y-e.y*a.x,this._w=o),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(clamp(this.dot(e),-1,1)))}rotateTowards(e,a){const o=this.angleTo(e);if(o===0)return this;const c=Math.min(1,a/o);return this.slerp(e,c),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,a){const o=e._x,c=e._y,d=e._z,g=e._w,_=a._x,b=a._y,$=a._z,tt=a._w;return this._x=o*tt+g*_+c*$-d*b,this._y=c*tt+g*b+d*_-o*$,this._z=d*tt+g*$+o*b-c*_,this._w=g*tt-o*_-c*b-d*$,this._onChangeCallback(),this}slerp(e,a){if(a===0)return this;if(a===1)return this.copy(e);const o=this._x,c=this._y,d=this._z,g=this._w;let _=g*e._w+o*e._x+c*e._y+d*e._z;if(_<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,_=-_):this.copy(e),_>=1)return this._w=g,this._x=o,this._y=c,this._z=d,this;const b=1-_*_;if(b<=Number.EPSILON){const st=1-a;return this._w=st*g+a*this._w,this._x=st*o+a*this._x,this._y=st*c+a*this._y,this._z=st*d+a*this._z,this.normalize(),this}const $=Math.sqrt(b),tt=Math.atan2($,_),rt=Math.sin((1-a)*tt)/$,et=Math.sin(a*tt)/$;return this._w=g*rt+this._w*et,this._x=o*rt+this._x*et,this._y=c*rt+this._y*et,this._z=d*rt+this._z*et,this._onChangeCallback(),this}slerpQuaternions(e,a,o){return this.copy(e).slerp(a,o)}random(){const e=2*Math.PI*Math.random(),a=2*Math.PI*Math.random(),o=Math.random(),c=Math.sqrt(1-o),d=Math.sqrt(o);return this.set(c*Math.sin(e),c*Math.cos(e),d*Math.sin(a),d*Math.cos(a))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,a=0){return this._x=e[a],this._y=e[a+1],this._z=e[a+2],this._w=e[a+3],this._onChangeCallback(),this}toArray(e=[],a=0){return e[a]=this._x,e[a+1]=this._y,e[a+2]=this._z,e[a+3]=this._w,e}fromBufferAttribute(e,a){return this._x=e.getX(a),this._y=e.getY(a),this._z=e.getZ(a),this._w=e.getW(a),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class Vector3{constructor(e=0,a=0,o=0){Vector3.prototype.isVector3=!0,this.x=e,this.y=a,this.z=o}set(e,a,o){return o===void 0&&(o=this.z),this.x=e,this.y=a,this.z=o,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,a){switch(e){case 0:this.x=a;break;case 1:this.y=a;break;case 2:this.z=a;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,a){return this.x=e.x+a.x,this.y=e.y+a.y,this.z=e.z+a.z,this}addScaledVector(e,a){return this.x+=e.x*a,this.y+=e.y*a,this.z+=e.z*a,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,a){return this.x=e.x-a.x,this.y=e.y-a.y,this.z=e.z-a.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,a){return this.x=e.x*a.x,this.y=e.y*a.y,this.z=e.z*a.z,this}applyEuler(e){return this.applyQuaternion(_quaternion$4.setFromEuler(e))}applyAxisAngle(e,a){return this.applyQuaternion(_quaternion$4.setFromAxisAngle(e,a))}applyMatrix3(e){const a=this.x,o=this.y,c=this.z,d=e.elements;return this.x=d[0]*a+d[3]*o+d[6]*c,this.y=d[1]*a+d[4]*o+d[7]*c,this.z=d[2]*a+d[5]*o+d[8]*c,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const a=this.x,o=this.y,c=this.z,d=e.elements,g=1/(d[3]*a+d[7]*o+d[11]*c+d[15]);return this.x=(d[0]*a+d[4]*o+d[8]*c+d[12])*g,this.y=(d[1]*a+d[5]*o+d[9]*c+d[13])*g,this.z=(d[2]*a+d[6]*o+d[10]*c+d[14])*g,this}applyQuaternion(e){const a=this.x,o=this.y,c=this.z,d=e.x,g=e.y,_=e.z,b=e.w,$=2*(g*c-_*o),tt=2*(_*a-d*c),rt=2*(d*o-g*a);return this.x=a+b*$+g*rt-_*tt,this.y=o+b*tt+_*$-d*rt,this.z=c+b*rt+d*tt-g*$,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const a=this.x,o=this.y,c=this.z,d=e.elements;return this.x=d[0]*a+d[4]*o+d[8]*c,this.y=d[1]*a+d[5]*o+d[9]*c,this.z=d[2]*a+d[6]*o+d[10]*c,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,a){return this.x=Math.max(e.x,Math.min(a.x,this.x)),this.y=Math.max(e.y,Math.min(a.y,this.y)),this.z=Math.max(e.z,Math.min(a.z,this.z)),this}clampScalar(e,a){return this.x=Math.max(e,Math.min(a,this.x)),this.y=Math.max(e,Math.min(a,this.y)),this.z=Math.max(e,Math.min(a,this.z)),this}clampLength(e,a){const o=this.length();return this.divideScalar(o||1).multiplyScalar(Math.max(e,Math.min(a,o)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,a){return this.x+=(e.x-this.x)*a,this.y+=(e.y-this.y)*a,this.z+=(e.z-this.z)*a,this}lerpVectors(e,a,o){return this.x=e.x+(a.x-e.x)*o,this.y=e.y+(a.y-e.y)*o,this.z=e.z+(a.z-e.z)*o,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,a){const o=e.x,c=e.y,d=e.z,g=a.x,_=a.y,b=a.z;return this.x=c*b-d*_,this.y=d*g-o*b,this.z=o*_-c*g,this}projectOnVector(e){const a=e.lengthSq();if(a===0)return this.set(0,0,0);const o=e.dot(this)/a;return this.copy(e).multiplyScalar(o)}projectOnPlane(e){return _vector$c.copy(this).projectOnVector(e),this.sub(_vector$c)}reflect(e){return this.sub(_vector$c.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const a=Math.sqrt(this.lengthSq()*e.lengthSq());if(a===0)return Math.PI/2;const o=this.dot(e)/a;return Math.acos(clamp(o,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const a=this.x-e.x,o=this.y-e.y,c=this.z-e.z;return a*a+o*o+c*c}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,a,o){const c=Math.sin(a)*e;return this.x=c*Math.sin(o),this.y=Math.cos(a)*e,this.z=c*Math.cos(o),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,a,o){return this.x=e*Math.sin(a),this.y=o,this.z=e*Math.cos(a),this}setFromMatrixPosition(e){const a=e.elements;return this.x=a[12],this.y=a[13],this.z=a[14],this}setFromMatrixScale(e){const a=this.setFromMatrixColumn(e,0).length(),o=this.setFromMatrixColumn(e,1).length(),c=this.setFromMatrixColumn(e,2).length();return this.x=a,this.y=o,this.z=c,this}setFromMatrixColumn(e,a){return this.fromArray(e.elements,a*4)}setFromMatrix3Column(e,a){return this.fromArray(e.elements,a*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,a=0){return this.x=e[a],this.y=e[a+1],this.z=e[a+2],this}toArray(e=[],a=0){return e[a]=this.x,e[a+1]=this.y,e[a+2]=this.z,e}fromBufferAttribute(e,a){return this.x=e.getX(a),this.y=e.getY(a),this.z=e.getZ(a),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,a=Math.random()*2-1,o=Math.sqrt(1-a*a);return this.x=o*Math.cos(e),this.y=a,this.z=o*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const _vector$c=new Vector3,_quaternion$4=new Quaternion;class Box3{constructor(e=new Vector3(1/0,1/0,1/0),a=new Vector3(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=a}set(e,a){return this.min.copy(e),this.max.copy(a),this}setFromArray(e){this.makeEmpty();for(let a=0,o=e.length;a<o;a+=3)this.expandByPoint(_vector$b.fromArray(e,a));return this}setFromBufferAttribute(e){this.makeEmpty();for(let a=0,o=e.count;a<o;a++)this.expandByPoint(_vector$b.fromBufferAttribute(e,a));return this}setFromPoints(e){this.makeEmpty();for(let a=0,o=e.length;a<o;a++)this.expandByPoint(e[a]);return this}setFromCenterAndSize(e,a){const o=_vector$b.copy(a).multiplyScalar(.5);return this.min.copy(e).sub(o),this.max.copy(e).add(o),this}setFromObject(e,a=!1){return this.makeEmpty(),this.expandByObject(e,a)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,a=!1){e.updateWorldMatrix(!1,!1);const o=e.geometry;if(o!==void 0){const d=o.getAttribute("position");if(a===!0&&d!==void 0&&e.isInstancedMesh!==!0)for(let g=0,_=d.count;g<_;g++)e.isMesh===!0?e.getVertexPosition(g,_vector$b):_vector$b.fromBufferAttribute(d,g),_vector$b.applyMatrix4(e.matrixWorld),this.expandByPoint(_vector$b);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),_box$4.copy(e.boundingBox)):(o.boundingBox===null&&o.computeBoundingBox(),_box$4.copy(o.boundingBox)),_box$4.applyMatrix4(e.matrixWorld),this.union(_box$4)}const c=e.children;for(let d=0,g=c.length;d<g;d++)this.expandByObject(c[d],a);return this}containsPoint(e){return!(e.x<this.min.x||e.x>this.max.x||e.y<this.min.y||e.y>this.max.y||e.z<this.min.z||e.z>this.max.z)}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,a){return a.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return!(e.max.x<this.min.x||e.min.x>this.max.x||e.max.y<this.min.y||e.min.y>this.max.y||e.max.z<this.min.z||e.min.z>this.max.z)}intersectsSphere(e){return this.clampPoint(e.center,_vector$b),_vector$b.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let a,o;return e.normal.x>0?(a=e.normal.x*this.min.x,o=e.normal.x*this.max.x):(a=e.normal.x*this.max.x,o=e.normal.x*this.min.x),e.normal.y>0?(a+=e.normal.y*this.min.y,o+=e.normal.y*this.max.y):(a+=e.normal.y*this.max.y,o+=e.normal.y*this.min.y),e.normal.z>0?(a+=e.normal.z*this.min.z,o+=e.normal.z*this.max.z):(a+=e.normal.z*this.max.z,o+=e.normal.z*this.min.z),a<=-e.constant&&o>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(_center),_extents.subVectors(this.max,_center),_v0$2.subVectors(e.a,_center),_v1$7.subVectors(e.b,_center),_v2$4.subVectors(e.c,_center),_f0.subVectors(_v1$7,_v0$2),_f1.subVectors(_v2$4,_v1$7),_f2.subVectors(_v0$2,_v2$4);let a=[0,-_f0.z,_f0.y,0,-_f1.z,_f1.y,0,-_f2.z,_f2.y,_f0.z,0,-_f0.x,_f1.z,0,-_f1.x,_f2.z,0,-_f2.x,-_f0.y,_f0.x,0,-_f1.y,_f1.x,0,-_f2.y,_f2.x,0];return!satForAxes(a,_v0$2,_v1$7,_v2$4,_extents)||(a=[1,0,0,0,1,0,0,0,1],!satForAxes(a,_v0$2,_v1$7,_v2$4,_extents))?!1:(_triangleNormal.crossVectors(_f0,_f1),a=[_triangleNormal.x,_triangleNormal.y,_triangleNormal.z],satForAxes(a,_v0$2,_v1$7,_v2$4,_extents))}clampPoint(e,a){return a.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,_vector$b).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(_vector$b).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(_points[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),_points[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),_points[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),_points[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),_points[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),_points[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),_points[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),_points[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(_points),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const _points=[new Vector3,new Vector3,new Vector3,new Vector3,new Vector3,new Vector3,new Vector3,new Vector3],_vector$b=new Vector3,_box$4=new Box3,_v0$2=new Vector3,_v1$7=new Vector3,_v2$4=new Vector3,_f0=new Vector3,_f1=new Vector3,_f2=new Vector3,_center=new Vector3,_extents=new Vector3,_triangleNormal=new Vector3,_testAxis=new Vector3;function satForAxes(s,e,a,o,c){for(let d=0,g=s.length-3;d<=g;d+=3){_testAxis.fromArray(s,d);const _=c.x*Math.abs(_testAxis.x)+c.y*Math.abs(_testAxis.y)+c.z*Math.abs(_testAxis.z),b=e.dot(_testAxis),$=a.dot(_testAxis),tt=o.dot(_testAxis);if(Math.max(-Math.max(b,$,tt),Math.min(b,$,tt))>_)return!1}return!0}const _box$3=new Box3,_v1$6=new Vector3,_v2$3=new Vector3;class Sphere{constructor(e=new Vector3,a=-1){this.isSphere=!0,this.center=e,this.radius=a}set(e,a){return this.center.copy(e),this.radius=a,this}setFromPoints(e,a){const o=this.center;a!==void 0?o.copy(a):_box$3.setFromPoints(e).getCenter(o);let c=0;for(let d=0,g=e.length;d<g;d++)c=Math.max(c,o.distanceToSquared(e[d]));return this.radius=Math.sqrt(c),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const a=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=a*a}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,a){const o=this.center.distanceToSquared(e);return a.copy(e),o>this.radius*this.radius&&(a.sub(this.center).normalize(),a.multiplyScalar(this.radius).add(this.center)),a}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;_v1$6.subVectors(e,this.center);const a=_v1$6.lengthSq();if(a>this.radius*this.radius){const o=Math.sqrt(a),c=(o-this.radius)*.5;this.center.addScaledVector(_v1$6,c/o),this.radius+=c}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(_v2$3.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(_v1$6.copy(e.center).add(_v2$3)),this.expandByPoint(_v1$6.copy(e.center).sub(_v2$3))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const _vector$a=new Vector3,_segCenter=new Vector3,_segDir=new Vector3,_diff=new Vector3,_edge1=new Vector3,_edge2=new Vector3,_normal$1=new Vector3;class Ray{constructor(e=new Vector3,a=new Vector3(0,0,-1)){this.origin=e,this.direction=a}set(e,a){return this.origin.copy(e),this.direction.copy(a),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,a){return a.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,_vector$a)),this}closestPointToPoint(e,a){a.subVectors(e,this.origin);const o=a.dot(this.direction);return o<0?a.copy(this.origin):a.copy(this.origin).addScaledVector(this.direction,o)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const a=_vector$a.subVectors(e,this.origin).dot(this.direction);return a<0?this.origin.distanceToSquared(e):(_vector$a.copy(this.origin).addScaledVector(this.direction,a),_vector$a.distanceToSquared(e))}distanceSqToSegment(e,a,o,c){_segCenter.copy(e).add(a).multiplyScalar(.5),_segDir.copy(a).sub(e).normalize(),_diff.copy(this.origin).sub(_segCenter);const d=e.distanceTo(a)*.5,g=-this.direction.dot(_segDir),_=_diff.dot(this.direction),b=-_diff.dot(_segDir),$=_diff.lengthSq(),tt=Math.abs(1-g*g);let rt,et,st,ot;if(tt>0)if(rt=g*b-_,et=g*_-b,ot=d*tt,rt>=0)if(et>=-ot)if(et<=ot){const at=1/tt;rt*=at,et*=at,st=rt*(rt+g*et+2*_)+et*(g*rt+et+2*b)+$}else et=d,rt=Math.max(0,-(g*et+_)),st=-rt*rt+et*(et+2*b)+$;else et=-d,rt=Math.max(0,-(g*et+_)),st=-rt*rt+et*(et+2*b)+$;else et<=-ot?(rt=Math.max(0,-(-g*d+_)),et=rt>0?-d:Math.min(Math.max(-d,-b),d),st=-rt*rt+et*(et+2*b)+$):et<=ot?(rt=0,et=Math.min(Math.max(-d,-b),d),st=et*(et+2*b)+$):(rt=Math.max(0,-(g*d+_)),et=rt>0?d:Math.min(Math.max(-d,-b),d),st=-rt*rt+et*(et+2*b)+$);else et=g>0?-d:d,rt=Math.max(0,-(g*et+_)),st=-rt*rt+et*(et+2*b)+$;return o&&o.copy(this.origin).addScaledVector(this.direction,rt),c&&c.copy(_segCenter).addScaledVector(_segDir,et),st}intersectSphere(e,a){_vector$a.subVectors(e.center,this.origin);const o=_vector$a.dot(this.direction),c=_vector$a.dot(_vector$a)-o*o,d=e.radius*e.radius;if(c>d)return null;const g=Math.sqrt(d-c),_=o-g,b=o+g;return b<0?null:_<0?this.at(b,a):this.at(_,a)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const a=e.normal.dot(this.direction);if(a===0)return e.distanceToPoint(this.origin)===0?0:null;const o=-(this.origin.dot(e.normal)+e.constant)/a;return o>=0?o:null}intersectPlane(e,a){const o=this.distanceToPlane(e);return o===null?null:this.at(o,a)}intersectsPlane(e){const a=e.distanceToPoint(this.origin);return a===0||e.normal.dot(this.direction)*a<0}intersectBox(e,a){let o,c,d,g,_,b;const $=1/this.direction.x,tt=1/this.direction.y,rt=1/this.direction.z,et=this.origin;return $>=0?(o=(e.min.x-et.x)*$,c=(e.max.x-et.x)*$):(o=(e.max.x-et.x)*$,c=(e.min.x-et.x)*$),tt>=0?(d=(e.min.y-et.y)*tt,g=(e.max.y-et.y)*tt):(d=(e.max.y-et.y)*tt,g=(e.min.y-et.y)*tt),o>g||d>c||((d>o||isNaN(o))&&(o=d),(g<c||isNaN(c))&&(c=g),rt>=0?(_=(e.min.z-et.z)*rt,b=(e.max.z-et.z)*rt):(_=(e.max.z-et.z)*rt,b=(e.min.z-et.z)*rt),o>b||_>c)||((_>o||o!==o)&&(o=_),(b<c||c!==c)&&(c=b),c<0)?null:this.at(o>=0?o:c,a)}intersectsBox(e){return this.intersectBox(e,_vector$a)!==null}intersectTriangle(e,a,o,c,d){_edge1.subVectors(a,e),_edge2.subVectors(o,e),_normal$1.crossVectors(_edge1,_edge2);let g=this.direction.dot(_normal$1),_;if(g>0){if(c)return null;_=1}else if(g<0)_=-1,g=-g;else return null;_diff.subVectors(this.origin,e);const b=_*this.direction.dot(_edge2.crossVectors(_diff,_edge2));if(b<0)return null;const $=_*this.direction.dot(_edge1.cross(_diff));if($<0||b+$>g)return null;const tt=-_*_diff.dot(_normal$1);return tt<0?null:this.at(tt/g,d)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Matrix4{constructor(e,a,o,c,d,g,_,b,$,tt,rt,et,st,ot,at,lt){Matrix4.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,a,o,c,d,g,_,b,$,tt,rt,et,st,ot,at,lt)}set(e,a,o,c,d,g,_,b,$,tt,rt,et,st,ot,at,lt){const _e=this.elements;return _e[0]=e,_e[4]=a,_e[8]=o,_e[12]=c,_e[1]=d,_e[5]=g,_e[9]=_,_e[13]=b,_e[2]=$,_e[6]=tt,_e[10]=rt,_e[14]=et,_e[3]=st,_e[7]=ot,_e[11]=at,_e[15]=lt,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Matrix4().fromArray(this.elements)}copy(e){const a=this.elements,o=e.elements;return a[0]=o[0],a[1]=o[1],a[2]=o[2],a[3]=o[3],a[4]=o[4],a[5]=o[5],a[6]=o[6],a[7]=o[7],a[8]=o[8],a[9]=o[9],a[10]=o[10],a[11]=o[11],a[12]=o[12],a[13]=o[13],a[14]=o[14],a[15]=o[15],this}copyPosition(e){const a=this.elements,o=e.elements;return a[12]=o[12],a[13]=o[13],a[14]=o[14],this}setFromMatrix3(e){const a=e.elements;return this.set(a[0],a[3],a[6],0,a[1],a[4],a[7],0,a[2],a[5],a[8],0,0,0,0,1),this}extractBasis(e,a,o){return e.setFromMatrixColumn(this,0),a.setFromMatrixColumn(this,1),o.setFromMatrixColumn(this,2),this}makeBasis(e,a,o){return this.set(e.x,a.x,o.x,0,e.y,a.y,o.y,0,e.z,a.z,o.z,0,0,0,0,1),this}extractRotation(e){const a=this.elements,o=e.elements,c=1/_v1$5.setFromMatrixColumn(e,0).length(),d=1/_v1$5.setFromMatrixColumn(e,1).length(),g=1/_v1$5.setFromMatrixColumn(e,2).length();return a[0]=o[0]*c,a[1]=o[1]*c,a[2]=o[2]*c,a[3]=0,a[4]=o[4]*d,a[5]=o[5]*d,a[6]=o[6]*d,a[7]=0,a[8]=o[8]*g,a[9]=o[9]*g,a[10]=o[10]*g,a[11]=0,a[12]=0,a[13]=0,a[14]=0,a[15]=1,this}makeRotationFromEuler(e){const a=this.elements,o=e.x,c=e.y,d=e.z,g=Math.cos(o),_=Math.sin(o),b=Math.cos(c),$=Math.sin(c),tt=Math.cos(d),rt=Math.sin(d);if(e.order==="XYZ"){const et=g*tt,st=g*rt,ot=_*tt,at=_*rt;a[0]=b*tt,a[4]=-b*rt,a[8]=$,a[1]=st+ot*$,a[5]=et-at*$,a[9]=-_*b,a[2]=at-et*$,a[6]=ot+st*$,a[10]=g*b}else if(e.order==="YXZ"){const et=b*tt,st=b*rt,ot=$*tt,at=$*rt;a[0]=et+at*_,a[4]=ot*_-st,a[8]=g*$,a[1]=g*rt,a[5]=g*tt,a[9]=-_,a[2]=st*_-ot,a[6]=at+et*_,a[10]=g*b}else if(e.order==="ZXY"){const et=b*tt,st=b*rt,ot=$*tt,at=$*rt;a[0]=et-at*_,a[4]=-g*rt,a[8]=ot+st*_,a[1]=st+ot*_,a[5]=g*tt,a[9]=at-et*_,a[2]=-g*$,a[6]=_,a[10]=g*b}else if(e.order==="ZYX"){const et=g*tt,st=g*rt,ot=_*tt,at=_*rt;a[0]=b*tt,a[4]=ot*$-st,a[8]=et*$+at,a[1]=b*rt,a[5]=at*$+et,a[9]=st*$-ot,a[2]=-$,a[6]=_*b,a[10]=g*b}else if(e.order==="YZX"){const et=g*b,st=g*$,ot=_*b,at=_*$;a[0]=b*tt,a[4]=at-et*rt,a[8]=ot*rt+st,a[1]=rt,a[5]=g*tt,a[9]=-_*tt,a[2]=-$*tt,a[6]=st*rt+ot,a[10]=et-at*rt}else if(e.order==="XZY"){const et=g*b,st=g*$,ot=_*b,at=_*$;a[0]=b*tt,a[4]=-rt,a[8]=$*tt,a[1]=et*rt+at,a[5]=g*tt,a[9]=st*rt-ot,a[2]=ot*rt-st,a[6]=_*tt,a[10]=at*rt+et}return a[3]=0,a[7]=0,a[11]=0,a[12]=0,a[13]=0,a[14]=0,a[15]=1,this}makeRotationFromQuaternion(e){return this.compose(_zero,e,_one)}lookAt(e,a,o){const c=this.elements;return _z.subVectors(e,a),_z.lengthSq()===0&&(_z.z=1),_z.normalize(),_x.crossVectors(o,_z),_x.lengthSq()===0&&(Math.abs(o.z)===1?_z.x+=1e-4:_z.z+=1e-4,_z.normalize(),_x.crossVectors(o,_z)),_x.normalize(),_y.crossVectors(_z,_x),c[0]=_x.x,c[4]=_y.x,c[8]=_z.x,c[1]=_x.y,c[5]=_y.y,c[9]=_z.y,c[2]=_x.z,c[6]=_y.z,c[10]=_z.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,a){const o=e.elements,c=a.elements,d=this.elements,g=o[0],_=o[4],b=o[8],$=o[12],tt=o[1],rt=o[5],et=o[9],st=o[13],ot=o[2],at=o[6],lt=o[10],_e=o[14],it=o[3],nt=o[7],ct=o[11],ht=o[15],ft=c[0],pt=c[4],yt=c[8],vt=c[12],gt=c[1],Ct=c[5],Pt=c[9],Tt=c[13],Rt=c[2],wt=c[6],_t=c[10],St=c[14],ut=c[3],dt=c[7],Mt=c[11],At=c[15];return d[0]=g*ft+_*gt+b*Rt+$*ut,d[4]=g*pt+_*Ct+b*wt+$*dt,d[8]=g*yt+_*Pt+b*_t+$*Mt,d[12]=g*vt+_*Tt+b*St+$*At,d[1]=tt*ft+rt*gt+et*Rt+st*ut,d[5]=tt*pt+rt*Ct+et*wt+st*dt,d[9]=tt*yt+rt*Pt+et*_t+st*Mt,d[13]=tt*vt+rt*Tt+et*St+st*At,d[2]=ot*ft+at*gt+lt*Rt+_e*ut,d[6]=ot*pt+at*Ct+lt*wt+_e*dt,d[10]=ot*yt+at*Pt+lt*_t+_e*Mt,d[14]=ot*vt+at*Tt+lt*St+_e*At,d[3]=it*ft+nt*gt+ct*Rt+ht*ut,d[7]=it*pt+nt*Ct+ct*wt+ht*dt,d[11]=it*yt+nt*Pt+ct*_t+ht*Mt,d[15]=it*vt+nt*Tt+ct*St+ht*At,this}multiplyScalar(e){const a=this.elements;return a[0]*=e,a[4]*=e,a[8]*=e,a[12]*=e,a[1]*=e,a[5]*=e,a[9]*=e,a[13]*=e,a[2]*=e,a[6]*=e,a[10]*=e,a[14]*=e,a[3]*=e,a[7]*=e,a[11]*=e,a[15]*=e,this}determinant(){const e=this.elements,a=e[0],o=e[4],c=e[8],d=e[12],g=e[1],_=e[5],b=e[9],$=e[13],tt=e[2],rt=e[6],et=e[10],st=e[14],ot=e[3],at=e[7],lt=e[11],_e=e[15];return ot*(+d*b*rt-c*$*rt-d*_*et+o*$*et+c*_*st-o*b*st)+at*(+a*b*st-a*$*et+d*g*et-c*g*st+c*$*tt-d*b*tt)+lt*(+a*$*rt-a*_*st-d*g*rt+o*g*st+d*_*tt-o*$*tt)+_e*(-c*_*tt-a*b*rt+a*_*et+c*g*rt-o*g*et+o*b*tt)}transpose(){const e=this.elements;let a;return a=e[1],e[1]=e[4],e[4]=a,a=e[2],e[2]=e[8],e[8]=a,a=e[6],e[6]=e[9],e[9]=a,a=e[3],e[3]=e[12],e[12]=a,a=e[7],e[7]=e[13],e[13]=a,a=e[11],e[11]=e[14],e[14]=a,this}setPosition(e,a,o){const c=this.elements;return e.isVector3?(c[12]=e.x,c[13]=e.y,c[14]=e.z):(c[12]=e,c[13]=a,c[14]=o),this}invert(){const e=this.elements,a=e[0],o=e[1],c=e[2],d=e[3],g=e[4],_=e[5],b=e[6],$=e[7],tt=e[8],rt=e[9],et=e[10],st=e[11],ot=e[12],at=e[13],lt=e[14],_e=e[15],it=rt*lt*$-at*et*$+at*b*st-_*lt*st-rt*b*_e+_*et*_e,nt=ot*et*$-tt*lt*$-ot*b*st+g*lt*st+tt*b*_e-g*et*_e,ct=tt*at*$-ot*rt*$+ot*_*st-g*at*st-tt*_*_e+g*rt*_e,ht=ot*rt*b-tt*at*b-ot*_*et+g*at*et+tt*_*lt-g*rt*lt,ft=a*it+o*nt+c*ct+d*ht;if(ft===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const pt=1/ft;return e[0]=it*pt,e[1]=(at*et*d-rt*lt*d-at*c*st+o*lt*st+rt*c*_e-o*et*_e)*pt,e[2]=(_*lt*d-at*b*d+at*c*$-o*lt*$-_*c*_e+o*b*_e)*pt,e[3]=(rt*b*d-_*et*d-rt*c*$+o*et*$+_*c*st-o*b*st)*pt,e[4]=nt*pt,e[5]=(tt*lt*d-ot*et*d+ot*c*st-a*lt*st-tt*c*_e+a*et*_e)*pt,e[6]=(ot*b*d-g*lt*d-ot*c*$+a*lt*$+g*c*_e-a*b*_e)*pt,e[7]=(g*et*d-tt*b*d+tt*c*$-a*et*$-g*c*st+a*b*st)*pt,e[8]=ct*pt,e[9]=(ot*rt*d-tt*at*d-ot*o*st+a*at*st+tt*o*_e-a*rt*_e)*pt,e[10]=(g*at*d-ot*_*d+ot*o*$-a*at*$-g*o*_e+a*_*_e)*pt,e[11]=(tt*_*d-g*rt*d-tt*o*$+a*rt*$+g*o*st-a*_*st)*pt,e[12]=ht*pt,e[13]=(tt*at*c-ot*rt*c+ot*o*et-a*at*et-tt*o*lt+a*rt*lt)*pt,e[14]=(ot*_*c-g*at*c-ot*o*b+a*at*b+g*o*lt-a*_*lt)*pt,e[15]=(g*rt*c-tt*_*c+tt*o*b-a*rt*b-g*o*et+a*_*et)*pt,this}scale(e){const a=this.elements,o=e.x,c=e.y,d=e.z;return a[0]*=o,a[4]*=c,a[8]*=d,a[1]*=o,a[5]*=c,a[9]*=d,a[2]*=o,a[6]*=c,a[10]*=d,a[3]*=o,a[7]*=c,a[11]*=d,this}getMaxScaleOnAxis(){const e=this.elements,a=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],o=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],c=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(a,o,c))}makeTranslation(e,a,o){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,a,0,0,1,o,0,0,0,1),this}makeRotationX(e){const a=Math.cos(e),o=Math.sin(e);return this.set(1,0,0,0,0,a,-o,0,0,o,a,0,0,0,0,1),this}makeRotationY(e){const a=Math.cos(e),o=Math.sin(e);return this.set(a,0,o,0,0,1,0,0,-o,0,a,0,0,0,0,1),this}makeRotationZ(e){const a=Math.cos(e),o=Math.sin(e);return this.set(a,-o,0,0,o,a,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,a){const o=Math.cos(a),c=Math.sin(a),d=1-o,g=e.x,_=e.y,b=e.z,$=d*g,tt=d*_;return this.set($*g+o,$*_-c*b,$*b+c*_,0,$*_+c*b,tt*_+o,tt*b-c*g,0,$*b-c*_,tt*b+c*g,d*b*b+o,0,0,0,0,1),this}makeScale(e,a,o){return this.set(e,0,0,0,0,a,0,0,0,0,o,0,0,0,0,1),this}makeShear(e,a,o,c,d,g){return this.set(1,o,d,0,e,1,g,0,a,c,1,0,0,0,0,1),this}compose(e,a,o){const c=this.elements,d=a._x,g=a._y,_=a._z,b=a._w,$=d+d,tt=g+g,rt=_+_,et=d*$,st=d*tt,ot=d*rt,at=g*tt,lt=g*rt,_e=_*rt,it=b*$,nt=b*tt,ct=b*rt,ht=o.x,ft=o.y,pt=o.z;return c[0]=(1-(at+_e))*ht,c[1]=(st+ct)*ht,c[2]=(ot-nt)*ht,c[3]=0,c[4]=(st-ct)*ft,c[5]=(1-(et+_e))*ft,c[6]=(lt+it)*ft,c[7]=0,c[8]=(ot+nt)*pt,c[9]=(lt-it)*pt,c[10]=(1-(et+at))*pt,c[11]=0,c[12]=e.x,c[13]=e.y,c[14]=e.z,c[15]=1,this}decompose(e,a,o){const c=this.elements;let d=_v1$5.set(c[0],c[1],c[2]).length();const g=_v1$5.set(c[4],c[5],c[6]).length(),_=_v1$5.set(c[8],c[9],c[10]).length();this.determinant()<0&&(d=-d),e.x=c[12],e.y=c[13],e.z=c[14],_m1$4.copy(this);const $=1/d,tt=1/g,rt=1/_;return _m1$4.elements[0]*=$,_m1$4.elements[1]*=$,_m1$4.elements[2]*=$,_m1$4.elements[4]*=tt,_m1$4.elements[5]*=tt,_m1$4.elements[6]*=tt,_m1$4.elements[8]*=rt,_m1$4.elements[9]*=rt,_m1$4.elements[10]*=rt,a.setFromRotationMatrix(_m1$4),o.x=d,o.y=g,o.z=_,this}makePerspective(e,a,o,c,d,g,_=WebGLCoordinateSystem){const b=this.elements,$=2*d/(a-e),tt=2*d/(o-c),rt=(a+e)/(a-e),et=(o+c)/(o-c);let st,ot;if(_===WebGLCoordinateSystem)st=-(g+d)/(g-d),ot=-2*g*d/(g-d);else if(_===WebGPUCoordinateSystem)st=-g/(g-d),ot=-g*d/(g-d);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+_);return b[0]=$,b[4]=0,b[8]=rt,b[12]=0,b[1]=0,b[5]=tt,b[9]=et,b[13]=0,b[2]=0,b[6]=0,b[10]=st,b[14]=ot,b[3]=0,b[7]=0,b[11]=-1,b[15]=0,this}makeOrthographic(e,a,o,c,d,g,_=WebGLCoordinateSystem){const b=this.elements,$=1/(a-e),tt=1/(o-c),rt=1/(g-d),et=(a+e)*$,st=(o+c)*tt;let ot,at;if(_===WebGLCoordinateSystem)ot=(g+d)*rt,at=-2*rt;else if(_===WebGPUCoordinateSystem)ot=d*rt,at=-1*rt;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+_);return b[0]=2*$,b[4]=0,b[8]=0,b[12]=-et,b[1]=0,b[5]=2*tt,b[9]=0,b[13]=-st,b[2]=0,b[6]=0,b[10]=at,b[14]=-ot,b[3]=0,b[7]=0,b[11]=0,b[15]=1,this}equals(e){const a=this.elements,o=e.elements;for(let c=0;c<16;c++)if(a[c]!==o[c])return!1;return!0}fromArray(e,a=0){for(let o=0;o<16;o++)this.elements[o]=e[o+a];return this}toArray(e=[],a=0){const o=this.elements;return e[a]=o[0],e[a+1]=o[1],e[a+2]=o[2],e[a+3]=o[3],e[a+4]=o[4],e[a+5]=o[5],e[a+6]=o[6],e[a+7]=o[7],e[a+8]=o[8],e[a+9]=o[9],e[a+10]=o[10],e[a+11]=o[11],e[a+12]=o[12],e[a+13]=o[13],e[a+14]=o[14],e[a+15]=o[15],e}}const _v1$5=new Vector3,_m1$4=new Matrix4,_zero=new Vector3(0,0,0),_one=new Vector3(1,1,1),_x=new Vector3,_y=new Vector3,_z=new Vector3,_matrix$2=new Matrix4,_quaternion$3=new Quaternion;class Euler{constructor(e=0,a=0,o=0,c=Euler.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=a,this._z=o,this._order=c}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,a,o,c=this._order){return this._x=e,this._y=a,this._z=o,this._order=c,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,a=this._order,o=!0){const c=e.elements,d=c[0],g=c[4],_=c[8],b=c[1],$=c[5],tt=c[9],rt=c[2],et=c[6],st=c[10];switch(a){case"XYZ":this._y=Math.asin(clamp(_,-1,1)),Math.abs(_)<.9999999?(this._x=Math.atan2(-tt,st),this._z=Math.atan2(-g,d)):(this._x=Math.atan2(et,$),this._z=0);break;case"YXZ":this._x=Math.asin(-clamp(tt,-1,1)),Math.abs(tt)<.9999999?(this._y=Math.atan2(_,st),this._z=Math.atan2(b,$)):(this._y=Math.atan2(-rt,d),this._z=0);break;case"ZXY":this._x=Math.asin(clamp(et,-1,1)),Math.abs(et)<.9999999?(this._y=Math.atan2(-rt,st),this._z=Math.atan2(-g,$)):(this._y=0,this._z=Math.atan2(b,d));break;case"ZYX":this._y=Math.asin(-clamp(rt,-1,1)),Math.abs(rt)<.9999999?(this._x=Math.atan2(et,st),this._z=Math.atan2(b,d)):(this._x=0,this._z=Math.atan2(-g,$));break;case"YZX":this._z=Math.asin(clamp(b,-1,1)),Math.abs(b)<.9999999?(this._x=Math.atan2(-tt,$),this._y=Math.atan2(-rt,d)):(this._x=0,this._y=Math.atan2(_,st));break;case"XZY":this._z=Math.asin(-clamp(g,-1,1)),Math.abs(g)<.9999999?(this._x=Math.atan2(et,$),this._y=Math.atan2(_,d)):(this._x=Math.atan2(-tt,st),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+a)}return this._order=a,o===!0&&this._onChangeCallback(),this}setFromQuaternion(e,a,o){return _matrix$2.makeRotationFromQuaternion(e),this.setFromRotationMatrix(_matrix$2,a,o)}setFromVector3(e,a=this._order){return this.set(e.x,e.y,e.z,a)}reorder(e){return _quaternion$3.setFromEuler(this),this.setFromQuaternion(_quaternion$3,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],a=0){return e[a]=this._x,e[a+1]=this._y,e[a+2]=this._z,e[a+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Euler.DEFAULT_ORDER="XYZ";class Layers{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let _object3DId=0;const _v1$4=new Vector3,_q1=new Quaternion,_m1$3=new Matrix4,_target=new Vector3,_position$3=new Vector3,_scale$2=new Vector3,_quaternion$2=new Quaternion,_xAxis=new Vector3(1,0,0),_yAxis=new Vector3(0,1,0),_zAxis=new Vector3(0,0,1),_addedEvent={type:"added"},_removedEvent={type:"removed"},_childaddedEvent={type:"childadded",child:null},_childremovedEvent={type:"childremoved",child:null};class Object3D extends EventDispatcher{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:_object3DId++}),this.uuid=generateUUID(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Object3D.DEFAULT_UP.clone();const e=new Vector3,a=new Euler,o=new Quaternion,c=new Vector3(1,1,1);function d(){o.setFromEuler(a,!1)}function g(){a.setFromQuaternion(o,void 0,!1)}a._onChange(d),o._onChange(g),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:a},quaternion:{configurable:!0,enumerable:!0,value:o},scale:{configurable:!0,enumerable:!0,value:c},modelViewMatrix:{value:new Matrix4},normalMatrix:{value:new Matrix3}}),this.matrix=new Matrix4,this.matrixWorld=new Matrix4,this.matrixAutoUpdate=Object3D.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Layers,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,a){this.quaternion.setFromAxisAngle(e,a)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,a){return _q1.setFromAxisAngle(e,a),this.quaternion.multiply(_q1),this}rotateOnWorldAxis(e,a){return _q1.setFromAxisAngle(e,a),this.quaternion.premultiply(_q1),this}rotateX(e){return this.rotateOnAxis(_xAxis,e)}rotateY(e){return this.rotateOnAxis(_yAxis,e)}rotateZ(e){return this.rotateOnAxis(_zAxis,e)}translateOnAxis(e,a){return _v1$4.copy(e).applyQuaternion(this.quaternion),this.position.add(_v1$4.multiplyScalar(a)),this}translateX(e){return this.translateOnAxis(_xAxis,e)}translateY(e){return this.translateOnAxis(_yAxis,e)}translateZ(e){return this.translateOnAxis(_zAxis,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(_m1$3.copy(this.matrixWorld).invert())}lookAt(e,a,o){e.isVector3?_target.copy(e):_target.set(e,a,o);const c=this.parent;this.updateWorldMatrix(!0,!1),_position$3.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?_m1$3.lookAt(_position$3,_target,this.up):_m1$3.lookAt(_target,_position$3,this.up),this.quaternion.setFromRotationMatrix(_m1$3),c&&(_m1$3.extractRotation(c.matrixWorld),_q1.setFromRotationMatrix(_m1$3),this.quaternion.premultiply(_q1.invert()))}add(e){if(arguments.length>1){for(let a=0;a<arguments.length;a++)this.add(arguments[a]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(_addedEvent),_childaddedEvent.child=e,this.dispatchEvent(_childaddedEvent),_childaddedEvent.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let o=0;o<arguments.length;o++)this.remove(arguments[o]);return this}const a=this.children.indexOf(e);return a!==-1&&(e.parent=null,this.children.splice(a,1),e.dispatchEvent(_removedEvent),_childremovedEvent.child=e,this.dispatchEvent(_childremovedEvent),_childremovedEvent.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),_m1$3.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),_m1$3.multiply(e.parent.matrixWorld)),e.applyMatrix4(_m1$3),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(_addedEvent),_childaddedEvent.child=e,this.dispatchEvent(_childaddedEvent),_childaddedEvent.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,a){if(this[e]===a)return this;for(let o=0,c=this.children.length;o<c;o++){const g=this.children[o].getObjectByProperty(e,a);if(g!==void 0)return g}}getObjectsByProperty(e,a,o=[]){this[e]===a&&o.push(this);const c=this.children;for(let d=0,g=c.length;d<g;d++)c[d].getObjectsByProperty(e,a,o);return o}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(_position$3,e,_scale$2),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(_position$3,_quaternion$2,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const a=this.matrixWorld.elements;return e.set(a[8],a[9],a[10]).normalize()}raycast(){}traverse(e){e(this);const a=this.children;for(let o=0,c=a.length;o<c;o++)a[o].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const a=this.children;for(let o=0,c=a.length;o<c;o++)a[o].traverseVisible(e)}traverseAncestors(e){const a=this.parent;a!==null&&(e(a),a.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),this.matrixWorldNeedsUpdate=!1,e=!0);const a=this.children;for(let o=0,c=a.length;o<c;o++){const d=a[o];(d.matrixWorldAutoUpdate===!0||e===!0)&&d.updateMatrixWorld(e)}}updateWorldMatrix(e,a){const o=this.parent;if(e===!0&&o!==null&&o.matrixWorldAutoUpdate===!0&&o.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),a===!0){const c=this.children;for(let d=0,g=c.length;d<g;d++){const _=c[d];_.matrixWorldAutoUpdate===!0&&_.updateWorldMatrix(!1,!0)}}}toJSON(e){const a=e===void 0||typeof e=="string",o={};a&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},o.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const c={};c.uuid=this.uuid,c.type=this.type,this.name!==""&&(c.name=this.name),this.castShadow===!0&&(c.castShadow=!0),this.receiveShadow===!0&&(c.receiveShadow=!0),this.visible===!1&&(c.visible=!1),this.frustumCulled===!1&&(c.frustumCulled=!1),this.renderOrder!==0&&(c.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(c.userData=this.userData),c.layers=this.layers.mask,c.matrix=this.matrix.toArray(),c.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(c.matrixAutoUpdate=!1),this.isInstancedMesh&&(c.type="InstancedMesh",c.count=this.count,c.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(c.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(c.type="BatchedMesh",c.perObjectFrustumCulled=this.perObjectFrustumCulled,c.sortObjects=this.sortObjects,c.drawRanges=this._drawRanges,c.reservedRanges=this._reservedRanges,c.visibility=this._visibility,c.active=this._active,c.bounds=this._bounds.map(_=>({boxInitialized:_.boxInitialized,boxMin:_.box.min.toArray(),boxMax:_.box.max.toArray(),sphereInitialized:_.sphereInitialized,sphereRadius:_.sphere.radius,sphereCenter:_.sphere.center.toArray()})),c.maxGeometryCount=this._maxGeometryCount,c.maxVertexCount=this._maxVertexCount,c.maxIndexCount=this._maxIndexCount,c.geometryInitialized=this._geometryInitialized,c.geometryCount=this._geometryCount,c.matricesTexture=this._matricesTexture.toJSON(e),this.boundingSphere!==null&&(c.boundingSphere={center:c.boundingSphere.center.toArray(),radius:c.boundingSphere.radius}),this.boundingBox!==null&&(c.boundingBox={min:c.boundingBox.min.toArray(),max:c.boundingBox.max.toArray()}));function d(_,b){return _[b.uuid]===void 0&&(_[b.uuid]=b.toJSON(e)),b.uuid}if(this.isScene)this.background&&(this.background.isColor?c.background=this.background.toJSON():this.background.isTexture&&(c.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(c.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){c.geometry=d(e.geometries,this.geometry);const _=this.geometry.parameters;if(_!==void 0&&_.shapes!==void 0){const b=_.shapes;if(Array.isArray(b))for(let $=0,tt=b.length;$<tt;$++){const rt=b[$];d(e.shapes,rt)}else d(e.shapes,b)}}if(this.isSkinnedMesh&&(c.bindMode=this.bindMode,c.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(d(e.skeletons,this.skeleton),c.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const _=[];for(let b=0,$=this.material.length;b<$;b++)_.push(d(e.materials,this.material[b]));c.material=_}else c.material=d(e.materials,this.material);if(this.children.length>0){c.children=[];for(let _=0;_<this.children.length;_++)c.children.push(this.children[_].toJSON(e).object)}if(this.animations.length>0){c.animations=[];for(let _=0;_<this.animations.length;_++){const b=this.animations[_];c.animations.push(d(e.animations,b))}}if(a){const _=g(e.geometries),b=g(e.materials),$=g(e.textures),tt=g(e.images),rt=g(e.shapes),et=g(e.skeletons),st=g(e.animations),ot=g(e.nodes);_.length>0&&(o.geometries=_),b.length>0&&(o.materials=b),$.length>0&&(o.textures=$),tt.length>0&&(o.images=tt),rt.length>0&&(o.shapes=rt),et.length>0&&(o.skeletons=et),st.length>0&&(o.animations=st),ot.length>0&&(o.nodes=ot)}return o.object=c,o;function g(_){const b=[];for(const $ in _){const tt=_[$];delete tt.metadata,b.push(tt)}return b}}clone(e){return new this.constructor().copy(this,e)}copy(e,a=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),a===!0)for(let o=0;o<e.children.length;o++){const c=e.children[o];this.add(c.clone())}return this}}Object3D.DEFAULT_UP=new Vector3(0,1,0);Object3D.DEFAULT_MATRIX_AUTO_UPDATE=!0;Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const _v0$1=new Vector3,_v1$3=new Vector3,_v2$2=new Vector3,_v3$2=new Vector3,_vab=new Vector3,_vac=new Vector3,_vbc=new Vector3,_vap=new Vector3,_vbp=new Vector3,_vcp=new Vector3;class Triangle{constructor(e=new Vector3,a=new Vector3,o=new Vector3){this.a=e,this.b=a,this.c=o}static getNormal(e,a,o,c){c.subVectors(o,a),_v0$1.subVectors(e,a),c.cross(_v0$1);const d=c.lengthSq();return d>0?c.multiplyScalar(1/Math.sqrt(d)):c.set(0,0,0)}static getBarycoord(e,a,o,c,d){_v0$1.subVectors(c,a),_v1$3.subVectors(o,a),_v2$2.subVectors(e,a);const g=_v0$1.dot(_v0$1),_=_v0$1.dot(_v1$3),b=_v0$1.dot(_v2$2),$=_v1$3.dot(_v1$3),tt=_v1$3.dot(_v2$2),rt=g*$-_*_;if(rt===0)return d.set(0,0,0),null;const et=1/rt,st=($*b-_*tt)*et,ot=(g*tt-_*b)*et;return d.set(1-st-ot,ot,st)}static containsPoint(e,a,o,c){return this.getBarycoord(e,a,o,c,_v3$2)===null?!1:_v3$2.x>=0&&_v3$2.y>=0&&_v3$2.x+_v3$2.y<=1}static getInterpolation(e,a,o,c,d,g,_,b){return this.getBarycoord(e,a,o,c,_v3$2)===null?(b.x=0,b.y=0,"z"in b&&(b.z=0),"w"in b&&(b.w=0),null):(b.setScalar(0),b.addScaledVector(d,_v3$2.x),b.addScaledVector(g,_v3$2.y),b.addScaledVector(_,_v3$2.z),b)}static isFrontFacing(e,a,o,c){return _v0$1.subVectors(o,a),_v1$3.subVectors(e,a),_v0$1.cross(_v1$3).dot(c)<0}set(e,a,o){return this.a.copy(e),this.b.copy(a),this.c.copy(o),this}setFromPointsAndIndices(e,a,o,c){return this.a.copy(e[a]),this.b.copy(e[o]),this.c.copy(e[c]),this}setFromAttributeAndIndices(e,a,o,c){return this.a.fromBufferAttribute(e,a),this.b.fromBufferAttribute(e,o),this.c.fromBufferAttribute(e,c),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return _v0$1.subVectors(this.c,this.b),_v1$3.subVectors(this.a,this.b),_v0$1.cross(_v1$3).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return Triangle.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,a){return Triangle.getBarycoord(e,this.a,this.b,this.c,a)}getInterpolation(e,a,o,c,d){return Triangle.getInterpolation(e,this.a,this.b,this.c,a,o,c,d)}containsPoint(e){return Triangle.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return Triangle.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,a){const o=this.a,c=this.b,d=this.c;let g,_;_vab.subVectors(c,o),_vac.subVectors(d,o),_vap.subVectors(e,o);const b=_vab.dot(_vap),$=_vac.dot(_vap);if(b<=0&&$<=0)return a.copy(o);_vbp.subVectors(e,c);const tt=_vab.dot(_vbp),rt=_vac.dot(_vbp);if(tt>=0&&rt<=tt)return a.copy(c);const et=b*rt-tt*$;if(et<=0&&b>=0&&tt<=0)return g=b/(b-tt),a.copy(o).addScaledVector(_vab,g);_vcp.subVectors(e,d);const st=_vab.dot(_vcp),ot=_vac.dot(_vcp);if(ot>=0&&st<=ot)return a.copy(d);const at=st*$-b*ot;if(at<=0&&$>=0&&ot<=0)return _=$/($-ot),a.copy(o).addScaledVector(_vac,_);const lt=tt*ot-st*rt;if(lt<=0&&rt-tt>=0&&st-ot>=0)return _vbc.subVectors(d,c),_=(rt-tt)/(rt-tt+(st-ot)),a.copy(c).addScaledVector(_vbc,_);const _e=1/(lt+at+et);return g=at*_e,_=et*_e,a.copy(o).addScaledVector(_vab,g).addScaledVector(_vac,_)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const _colorKeywords={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},_hslA={h:0,s:0,l:0},_hslB={h:0,s:0,l:0};function hue2rgb(s,e,a){return a<0&&(a+=1),a>1&&(a-=1),a<1/6?s+(e-s)*6*a:a<1/2?e:a<2/3?s+(e-s)*6*(2/3-a):s}class Color{constructor(e,a,o){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,a,o)}set(e,a,o){if(a===void 0&&o===void 0){const c=e;c&&c.isColor?this.copy(c):typeof c=="number"?this.setHex(c):typeof c=="string"&&this.setStyle(c)}else this.setRGB(e,a,o);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,a=SRGBColorSpace){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,ColorManagement.toWorkingColorSpace(this,a),this}setRGB(e,a,o,c=ColorManagement.workingColorSpace){return this.r=e,this.g=a,this.b=o,ColorManagement.toWorkingColorSpace(this,c),this}setHSL(e,a,o,c=ColorManagement.workingColorSpace){if(e=euclideanModulo(e,1),a=clamp(a,0,1),o=clamp(o,0,1),a===0)this.r=this.g=this.b=o;else{const d=o<=.5?o*(1+a):o+a-o*a,g=2*o-d;this.r=hue2rgb(g,d,e+1/3),this.g=hue2rgb(g,d,e),this.b=hue2rgb(g,d,e-1/3)}return ColorManagement.toWorkingColorSpace(this,c),this}setStyle(e,a=SRGBColorSpace){function o(d){d!==void 0&&parseFloat(d)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let c;if(c=/^(\w+)\(([^\)]*)\)/.exec(e)){let d;const g=c[1],_=c[2];switch(g){case"rgb":case"rgba":if(d=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(_))return o(d[4]),this.setRGB(Math.min(255,parseInt(d[1],10))/255,Math.min(255,parseInt(d[2],10))/255,Math.min(255,parseInt(d[3],10))/255,a);if(d=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(_))return o(d[4]),this.setRGB(Math.min(100,parseInt(d[1],10))/100,Math.min(100,parseInt(d[2],10))/100,Math.min(100,parseInt(d[3],10))/100,a);break;case"hsl":case"hsla":if(d=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(_))return o(d[4]),this.setHSL(parseFloat(d[1])/360,parseFloat(d[2])/100,parseFloat(d[3])/100,a);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(c=/^\#([A-Fa-f\d]+)$/.exec(e)){const d=c[1],g=d.length;if(g===3)return this.setRGB(parseInt(d.charAt(0),16)/15,parseInt(d.charAt(1),16)/15,parseInt(d.charAt(2),16)/15,a);if(g===6)return this.setHex(parseInt(d,16),a);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,a);return this}setColorName(e,a=SRGBColorSpace){const o=_colorKeywords[e.toLowerCase()];return o!==void 0?this.setHex(o,a):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=SRGBToLinear(e.r),this.g=SRGBToLinear(e.g),this.b=SRGBToLinear(e.b),this}copyLinearToSRGB(e){return this.r=LinearToSRGB(e.r),this.g=LinearToSRGB(e.g),this.b=LinearToSRGB(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=SRGBColorSpace){return ColorManagement.fromWorkingColorSpace(_color.copy(this),e),Math.round(clamp(_color.r*255,0,255))*65536+Math.round(clamp(_color.g*255,0,255))*256+Math.round(clamp(_color.b*255,0,255))}getHexString(e=SRGBColorSpace){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,a=ColorManagement.workingColorSpace){ColorManagement.fromWorkingColorSpace(_color.copy(this),a);const o=_color.r,c=_color.g,d=_color.b,g=Math.max(o,c,d),_=Math.min(o,c,d);let b,$;const tt=(_+g)/2;if(_===g)b=0,$=0;else{const rt=g-_;switch($=tt<=.5?rt/(g+_):rt/(2-g-_),g){case o:b=(c-d)/rt+(c<d?6:0);break;case c:b=(d-o)/rt+2;break;case d:b=(o-c)/rt+4;break}b/=6}return e.h=b,e.s=$,e.l=tt,e}getRGB(e,a=ColorManagement.workingColorSpace){return ColorManagement.fromWorkingColorSpace(_color.copy(this),a),e.r=_color.r,e.g=_color.g,e.b=_color.b,e}getStyle(e=SRGBColorSpace){ColorManagement.fromWorkingColorSpace(_color.copy(this),e);const a=_color.r,o=_color.g,c=_color.b;return e!==SRGBColorSpace?`color(${e} ${a.toFixed(3)} ${o.toFixed(3)} ${c.toFixed(3)})`:`rgb(${Math.round(a*255)},${Math.round(o*255)},${Math.round(c*255)})`}offsetHSL(e,a,o){return this.getHSL(_hslA),this.setHSL(_hslA.h+e,_hslA.s+a,_hslA.l+o)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,a){return this.r=e.r+a.r,this.g=e.g+a.g,this.b=e.b+a.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,a){return this.r+=(e.r-this.r)*a,this.g+=(e.g-this.g)*a,this.b+=(e.b-this.b)*a,this}lerpColors(e,a,o){return this.r=e.r+(a.r-e.r)*o,this.g=e.g+(a.g-e.g)*o,this.b=e.b+(a.b-e.b)*o,this}lerpHSL(e,a){this.getHSL(_hslA),e.getHSL(_hslB);const o=lerp(_hslA.h,_hslB.h,a),c=lerp(_hslA.s,_hslB.s,a),d=lerp(_hslA.l,_hslB.l,a);return this.setHSL(o,c,d),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const a=this.r,o=this.g,c=this.b,d=e.elements;return this.r=d[0]*a+d[3]*o+d[6]*c,this.g=d[1]*a+d[4]*o+d[7]*c,this.b=d[2]*a+d[5]*o+d[8]*c,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,a=0){return this.r=e[a],this.g=e[a+1],this.b=e[a+2],this}toArray(e=[],a=0){return e[a]=this.r,e[a+1]=this.g,e[a+2]=this.b,e}fromBufferAttribute(e,a){return this.r=e.getX(a),this.g=e.getY(a),this.b=e.getZ(a),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const _color=new Color;Color.NAMES=_colorKeywords;let _materialId=0;class Material extends EventDispatcher{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:_materialId++}),this.uuid=generateUUID(),this.name="",this.type="Material",this.blending=NormalBlending,this.side=FrontSide,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=SrcAlphaFactor,this.blendDst=OneMinusSrcAlphaFactor,this.blendEquation=AddEquation,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Color(0,0,0),this.blendAlpha=0,this.depthFunc=LessEqualDepth,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=AlwaysStencilFunc,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=KeepStencilOp,this.stencilZFail=KeepStencilOp,this.stencilZPass=KeepStencilOp,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBuild(){}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const a in e){const o=e[a];if(o===void 0){console.warn(`THREE.Material: parameter '${a}' has value of undefined.`);continue}const c=this[a];if(c===void 0){console.warn(`THREE.Material: '${a}' is not a property of THREE.${this.type}.`);continue}c&&c.isColor?c.set(o):c&&c.isVector3&&o&&o.isVector3?c.copy(o):this[a]=o}}toJSON(e){const a=e===void 0||typeof e=="string";a&&(e={textures:{},images:{}});const o={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};o.uuid=this.uuid,o.type=this.type,this.name!==""&&(o.name=this.name),this.color&&this.color.isColor&&(o.color=this.color.getHex()),this.roughness!==void 0&&(o.roughness=this.roughness),this.metalness!==void 0&&(o.metalness=this.metalness),this.sheen!==void 0&&(o.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(o.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(o.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(o.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(o.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(o.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(o.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(o.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(o.shininess=this.shininess),this.clearcoat!==void 0&&(o.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(o.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(o.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(o.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(o.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,o.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.iridescence!==void 0&&(o.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(o.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(o.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(o.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(o.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(o.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(o.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(o.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(o.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(o.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(o.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(o.lightMap=this.lightMap.toJSON(e).uuid,o.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(o.aoMap=this.aoMap.toJSON(e).uuid,o.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(o.bumpMap=this.bumpMap.toJSON(e).uuid,o.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(o.normalMap=this.normalMap.toJSON(e).uuid,o.normalMapType=this.normalMapType,o.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(o.displacementMap=this.displacementMap.toJSON(e).uuid,o.displacementScale=this.displacementScale,o.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(o.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(o.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(o.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(o.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(o.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(o.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(o.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(o.combine=this.combine)),this.envMapRotation!==void 0&&(o.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(o.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(o.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(o.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(o.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(o.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(o.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(o.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(o.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(o.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(o.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(o.size=this.size),this.shadowSide!==null&&(o.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(o.sizeAttenuation=this.sizeAttenuation),this.blending!==NormalBlending&&(o.blending=this.blending),this.side!==FrontSide&&(o.side=this.side),this.vertexColors===!0&&(o.vertexColors=!0),this.opacity<1&&(o.opacity=this.opacity),this.transparent===!0&&(o.transparent=!0),this.blendSrc!==SrcAlphaFactor&&(o.blendSrc=this.blendSrc),this.blendDst!==OneMinusSrcAlphaFactor&&(o.blendDst=this.blendDst),this.blendEquation!==AddEquation&&(o.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(o.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(o.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(o.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(o.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(o.blendAlpha=this.blendAlpha),this.depthFunc!==LessEqualDepth&&(o.depthFunc=this.depthFunc),this.depthTest===!1&&(o.depthTest=this.depthTest),this.depthWrite===!1&&(o.depthWrite=this.depthWrite),this.colorWrite===!1&&(o.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(o.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==AlwaysStencilFunc&&(o.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(o.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(o.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==KeepStencilOp&&(o.stencilFail=this.stencilFail),this.stencilZFail!==KeepStencilOp&&(o.stencilZFail=this.stencilZFail),this.stencilZPass!==KeepStencilOp&&(o.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(o.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(o.rotation=this.rotation),this.polygonOffset===!0&&(o.polygonOffset=!0),this.polygonOffsetFactor!==0&&(o.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(o.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(o.linewidth=this.linewidth),this.dashSize!==void 0&&(o.dashSize=this.dashSize),this.gapSize!==void 0&&(o.gapSize=this.gapSize),this.scale!==void 0&&(o.scale=this.scale),this.dithering===!0&&(o.dithering=!0),this.alphaTest>0&&(o.alphaTest=this.alphaTest),this.alphaHash===!0&&(o.alphaHash=!0),this.alphaToCoverage===!0&&(o.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(o.premultipliedAlpha=!0),this.forceSinglePass===!0&&(o.forceSinglePass=!0),this.wireframe===!0&&(o.wireframe=!0),this.wireframeLinewidth>1&&(o.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(o.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(o.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(o.flatShading=!0),this.visible===!1&&(o.visible=!1),this.toneMapped===!1&&(o.toneMapped=!1),this.fog===!1&&(o.fog=!1),Object.keys(this.userData).length>0&&(o.userData=this.userData);function c(d){const g=[];for(const _ in d){const b=d[_];delete b.metadata,g.push(b)}return g}if(a){const d=c(e.textures),g=c(e.images);d.length>0&&(o.textures=d),g.length>0&&(o.images=g)}return o}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const a=e.clippingPlanes;let o=null;if(a!==null){const c=a.length;o=new Array(c);for(let d=0;d!==c;++d)o[d]=a[d].clone()}return this.clippingPlanes=o,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}}class MeshBasicMaterial extends Material{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Color(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Euler,this.combine=MultiplyOperation,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const _vector$9=new Vector3,_vector2$1=new Vector2;class BufferAttribute{constructor(e,a,o=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=a,this.count=e!==void 0?e.length/a:0,this.normalized=o,this.usage=StaticDrawUsage,this._updateRange={offset:0,count:-1},this.updateRanges=[],this.gpuType=FloatType,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}get updateRange(){return warnOnce("THREE.BufferAttribute: updateRange() is deprecated and will be removed in r169. Use addUpdateRange() instead."),this._updateRange}setUsage(e){return this.usage=e,this}addUpdateRange(e,a){this.updateRanges.push({start:e,count:a})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,a,o){e*=this.itemSize,o*=a.itemSize;for(let c=0,d=this.itemSize;c<d;c++)this.array[e+c]=a.array[o+c];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let a=0,o=this.count;a<o;a++)_vector2$1.fromBufferAttribute(this,a),_vector2$1.applyMatrix3(e),this.setXY(a,_vector2$1.x,_vector2$1.y);else if(this.itemSize===3)for(let a=0,o=this.count;a<o;a++)_vector$9.fromBufferAttribute(this,a),_vector$9.applyMatrix3(e),this.setXYZ(a,_vector$9.x,_vector$9.y,_vector$9.z);return this}applyMatrix4(e){for(let a=0,o=this.count;a<o;a++)_vector$9.fromBufferAttribute(this,a),_vector$9.applyMatrix4(e),this.setXYZ(a,_vector$9.x,_vector$9.y,_vector$9.z);return this}applyNormalMatrix(e){for(let a=0,o=this.count;a<o;a++)_vector$9.fromBufferAttribute(this,a),_vector$9.applyNormalMatrix(e),this.setXYZ(a,_vector$9.x,_vector$9.y,_vector$9.z);return this}transformDirection(e){for(let a=0,o=this.count;a<o;a++)_vector$9.fromBufferAttribute(this,a),_vector$9.transformDirection(e),this.setXYZ(a,_vector$9.x,_vector$9.y,_vector$9.z);return this}set(e,a=0){return this.array.set(e,a),this}getComponent(e,a){let o=this.array[e*this.itemSize+a];return this.normalized&&(o=denormalize(o,this.array)),o}setComponent(e,a,o){return this.normalized&&(o=normalize(o,this.array)),this.array[e*this.itemSize+a]=o,this}getX(e){let a=this.array[e*this.itemSize];return this.normalized&&(a=denormalize(a,this.array)),a}setX(e,a){return this.normalized&&(a=normalize(a,this.array)),this.array[e*this.itemSize]=a,this}getY(e){let a=this.array[e*this.itemSize+1];return this.normalized&&(a=denormalize(a,this.array)),a}setY(e,a){return this.normalized&&(a=normalize(a,this.array)),this.array[e*this.itemSize+1]=a,this}getZ(e){let a=this.array[e*this.itemSize+2];return this.normalized&&(a=denormalize(a,this.array)),a}setZ(e,a){return this.normalized&&(a=normalize(a,this.array)),this.array[e*this.itemSize+2]=a,this}getW(e){let a=this.array[e*this.itemSize+3];return this.normalized&&(a=denormalize(a,this.array)),a}setW(e,a){return this.normalized&&(a=normalize(a,this.array)),this.array[e*this.itemSize+3]=a,this}setXY(e,a,o){return e*=this.itemSize,this.normalized&&(a=normalize(a,this.array),o=normalize(o,this.array)),this.array[e+0]=a,this.array[e+1]=o,this}setXYZ(e,a,o,c){return e*=this.itemSize,this.normalized&&(a=normalize(a,this.array),o=normalize(o,this.array),c=normalize(c,this.array)),this.array[e+0]=a,this.array[e+1]=o,this.array[e+2]=c,this}setXYZW(e,a,o,c,d){return e*=this.itemSize,this.normalized&&(a=normalize(a,this.array),o=normalize(o,this.array),c=normalize(c,this.array),d=normalize(d,this.array)),this.array[e+0]=a,this.array[e+1]=o,this.array[e+2]=c,this.array[e+3]=d,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==StaticDrawUsage&&(e.usage=this.usage),e}}class Uint16BufferAttribute extends BufferAttribute{constructor(e,a,o){super(new Uint16Array(e),a,o)}}class Uint32BufferAttribute extends BufferAttribute{constructor(e,a,o){super(new Uint32Array(e),a,o)}}class Float32BufferAttribute extends BufferAttribute{constructor(e,a,o){super(new Float32Array(e),a,o)}}let _id$2=0;const _m1$2=new Matrix4,_obj=new Object3D,_offset=new Vector3,_box$2=new Box3,_boxMorphTargets=new Box3,_vector$8=new Vector3;class BufferGeometry extends EventDispatcher{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:_id$2++}),this.uuid=generateUUID(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(arrayNeedsUint32(e)?Uint32BufferAttribute:Uint16BufferAttribute)(e,1):this.index=e,this}getAttribute(e){return this.attributes[e]}setAttribute(e,a){return this.attributes[e]=a,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,a,o=0){this.groups.push({start:e,count:a,materialIndex:o})}clearGroups(){this.groups=[]}setDrawRange(e,a){this.drawRange.start=e,this.drawRange.count=a}applyMatrix4(e){const a=this.attributes.position;a!==void 0&&(a.applyMatrix4(e),a.needsUpdate=!0);const o=this.attributes.normal;if(o!==void 0){const d=new Matrix3().getNormalMatrix(e);o.applyNormalMatrix(d),o.needsUpdate=!0}const c=this.attributes.tangent;return c!==void 0&&(c.transformDirection(e),c.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return _m1$2.makeRotationFromQuaternion(e),this.applyMatrix4(_m1$2),this}rotateX(e){return _m1$2.makeRotationX(e),this.applyMatrix4(_m1$2),this}rotateY(e){return _m1$2.makeRotationY(e),this.applyMatrix4(_m1$2),this}rotateZ(e){return _m1$2.makeRotationZ(e),this.applyMatrix4(_m1$2),this}translate(e,a,o){return _m1$2.makeTranslation(e,a,o),this.applyMatrix4(_m1$2),this}scale(e,a,o){return _m1$2.makeScale(e,a,o),this.applyMatrix4(_m1$2),this}lookAt(e){return _obj.lookAt(e),_obj.updateMatrix(),this.applyMatrix4(_obj.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(_offset).negate(),this.translate(_offset.x,_offset.y,_offset.z),this}setFromPoints(e){const a=[];for(let o=0,c=e.length;o<c;o++){const d=e[o];a.push(d.x,d.y,d.z||0)}return this.setAttribute("position",new Float32BufferAttribute(a,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Box3);const e=this.attributes.position,a=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new Vector3(-1/0,-1/0,-1/0),new Vector3(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),a)for(let o=0,c=a.length;o<c;o++){const d=a[o];_box$2.setFromBufferAttribute(d),this.morphTargetsRelative?(_vector$8.addVectors(this.boundingBox.min,_box$2.min),this.boundingBox.expandByPoint(_vector$8),_vector$8.addVectors(this.boundingBox.max,_box$2.max),this.boundingBox.expandByPoint(_vector$8)):(this.boundingBox.expandByPoint(_box$2.min),this.boundingBox.expandByPoint(_box$2.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Sphere);const e=this.attributes.position,a=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new Vector3,1/0);return}if(e){const o=this.boundingSphere.center;if(_box$2.setFromBufferAttribute(e),a)for(let d=0,g=a.length;d<g;d++){const _=a[d];_boxMorphTargets.setFromBufferAttribute(_),this.morphTargetsRelative?(_vector$8.addVectors(_box$2.min,_boxMorphTargets.min),_box$2.expandByPoint(_vector$8),_vector$8.addVectors(_box$2.max,_boxMorphTargets.max),_box$2.expandByPoint(_vector$8)):(_box$2.expandByPoint(_boxMorphTargets.min),_box$2.expandByPoint(_boxMorphTargets.max))}_box$2.getCenter(o);let c=0;for(let d=0,g=e.count;d<g;d++)_vector$8.fromBufferAttribute(e,d),c=Math.max(c,o.distanceToSquared(_vector$8));if(a)for(let d=0,g=a.length;d<g;d++){const _=a[d],b=this.morphTargetsRelative;for(let $=0,tt=_.count;$<tt;$++)_vector$8.fromBufferAttribute(_,$),b&&(_offset.fromBufferAttribute(e,$),_vector$8.add(_offset)),c=Math.max(c,o.distanceToSquared(_vector$8))}this.boundingSphere.radius=Math.sqrt(c),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,a=this.attributes;if(e===null||a.position===void 0||a.normal===void 0||a.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const o=a.position,c=a.normal,d=a.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new BufferAttribute(new Float32Array(4*o.count),4));const g=this.getAttribute("tangent"),_=[],b=[];for(let yt=0;yt<o.count;yt++)_[yt]=new Vector3,b[yt]=new Vector3;const $=new Vector3,tt=new Vector3,rt=new Vector3,et=new Vector2,st=new Vector2,ot=new Vector2,at=new Vector3,lt=new Vector3;function _e(yt,vt,gt){$.fromBufferAttribute(o,yt),tt.fromBufferAttribute(o,vt),rt.fromBufferAttribute(o,gt),et.fromBufferAttribute(d,yt),st.fromBufferAttribute(d,vt),ot.fromBufferAttribute(d,gt),tt.sub($),rt.sub($),st.sub(et),ot.sub(et);const Ct=1/(st.x*ot.y-ot.x*st.y);isFinite(Ct)&&(at.copy(tt).multiplyScalar(ot.y).addScaledVector(rt,-st.y).multiplyScalar(Ct),lt.copy(rt).multiplyScalar(st.x).addScaledVector(tt,-ot.x).multiplyScalar(Ct),_[yt].add(at),_[vt].add(at),_[gt].add(at),b[yt].add(lt),b[vt].add(lt),b[gt].add(lt))}let it=this.groups;it.length===0&&(it=[{start:0,count:e.count}]);for(let yt=0,vt=it.length;yt<vt;++yt){const gt=it[yt],Ct=gt.start,Pt=gt.count;for(let Tt=Ct,Rt=Ct+Pt;Tt<Rt;Tt+=3)_e(e.getX(Tt+0),e.getX(Tt+1),e.getX(Tt+2))}const nt=new Vector3,ct=new Vector3,ht=new Vector3,ft=new Vector3;function pt(yt){ht.fromBufferAttribute(c,yt),ft.copy(ht);const vt=_[yt];nt.copy(vt),nt.sub(ht.multiplyScalar(ht.dot(vt))).normalize(),ct.crossVectors(ft,vt);const Ct=ct.dot(b[yt])<0?-1:1;g.setXYZW(yt,nt.x,nt.y,nt.z,Ct)}for(let yt=0,vt=it.length;yt<vt;++yt){const gt=it[yt],Ct=gt.start,Pt=gt.count;for(let Tt=Ct,Rt=Ct+Pt;Tt<Rt;Tt+=3)pt(e.getX(Tt+0)),pt(e.getX(Tt+1)),pt(e.getX(Tt+2))}}computeVertexNormals(){const e=this.index,a=this.getAttribute("position");if(a!==void 0){let o=this.getAttribute("normal");if(o===void 0)o=new BufferAttribute(new Float32Array(a.count*3),3),this.setAttribute("normal",o);else for(let et=0,st=o.count;et<st;et++)o.setXYZ(et,0,0,0);const c=new Vector3,d=new Vector3,g=new Vector3,_=new Vector3,b=new Vector3,$=new Vector3,tt=new Vector3,rt=new Vector3;if(e)for(let et=0,st=e.count;et<st;et+=3){const ot=e.getX(et+0),at=e.getX(et+1),lt=e.getX(et+2);c.fromBufferAttribute(a,ot),d.fromBufferAttribute(a,at),g.fromBufferAttribute(a,lt),tt.subVectors(g,d),rt.subVectors(c,d),tt.cross(rt),_.fromBufferAttribute(o,ot),b.fromBufferAttribute(o,at),$.fromBufferAttribute(o,lt),_.add(tt),b.add(tt),$.add(tt),o.setXYZ(ot,_.x,_.y,_.z),o.setXYZ(at,b.x,b.y,b.z),o.setXYZ(lt,$.x,$.y,$.z)}else for(let et=0,st=a.count;et<st;et+=3)c.fromBufferAttribute(a,et+0),d.fromBufferAttribute(a,et+1),g.fromBufferAttribute(a,et+2),tt.subVectors(g,d),rt.subVectors(c,d),tt.cross(rt),o.setXYZ(et+0,tt.x,tt.y,tt.z),o.setXYZ(et+1,tt.x,tt.y,tt.z),o.setXYZ(et+2,tt.x,tt.y,tt.z);this.normalizeNormals(),o.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let a=0,o=e.count;a<o;a++)_vector$8.fromBufferAttribute(e,a),_vector$8.normalize(),e.setXYZ(a,_vector$8.x,_vector$8.y,_vector$8.z)}toNonIndexed(){function e(_,b){const $=_.array,tt=_.itemSize,rt=_.normalized,et=new $.constructor(b.length*tt);let st=0,ot=0;for(let at=0,lt=b.length;at<lt;at++){_.isInterleavedBufferAttribute?st=b[at]*_.data.stride+_.offset:st=b[at]*tt;for(let _e=0;_e<tt;_e++)et[ot++]=$[st++]}return new BufferAttribute(et,tt,rt)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const a=new BufferGeometry,o=this.index.array,c=this.attributes;for(const _ in c){const b=c[_],$=e(b,o);a.setAttribute(_,$)}const d=this.morphAttributes;for(const _ in d){const b=[],$=d[_];for(let tt=0,rt=$.length;tt<rt;tt++){const et=$[tt],st=e(et,o);b.push(st)}a.morphAttributes[_]=b}a.morphTargetsRelative=this.morphTargetsRelative;const g=this.groups;for(let _=0,b=g.length;_<b;_++){const $=g[_];a.addGroup($.start,$.count,$.materialIndex)}return a}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const b=this.parameters;for(const $ in b)b[$]!==void 0&&(e[$]=b[$]);return e}e.data={attributes:{}};const a=this.index;a!==null&&(e.data.index={type:a.array.constructor.name,array:Array.prototype.slice.call(a.array)});const o=this.attributes;for(const b in o){const $=o[b];e.data.attributes[b]=$.toJSON(e.data)}const c={};let d=!1;for(const b in this.morphAttributes){const $=this.morphAttributes[b],tt=[];for(let rt=0,et=$.length;rt<et;rt++){const st=$[rt];tt.push(st.toJSON(e.data))}tt.length>0&&(c[b]=tt,d=!0)}d&&(e.data.morphAttributes=c,e.data.morphTargetsRelative=this.morphTargetsRelative);const g=this.groups;g.length>0&&(e.data.groups=JSON.parse(JSON.stringify(g)));const _=this.boundingSphere;return _!==null&&(e.data.boundingSphere={center:_.center.toArray(),radius:_.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const a={};this.name=e.name;const o=e.index;o!==null&&this.setIndex(o.clone(a));const c=e.attributes;for(const $ in c){const tt=c[$];this.setAttribute($,tt.clone(a))}const d=e.morphAttributes;for(const $ in d){const tt=[],rt=d[$];for(let et=0,st=rt.length;et<st;et++)tt.push(rt[et].clone(a));this.morphAttributes[$]=tt}this.morphTargetsRelative=e.morphTargetsRelative;const g=e.groups;for(let $=0,tt=g.length;$<tt;$++){const rt=g[$];this.addGroup(rt.start,rt.count,rt.materialIndex)}const _=e.boundingBox;_!==null&&(this.boundingBox=_.clone());const b=e.boundingSphere;return b!==null&&(this.boundingSphere=b.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const _inverseMatrix$3=new Matrix4,_ray$3=new Ray,_sphere$6=new Sphere,_sphereHitAt=new Vector3,_vA$1=new Vector3,_vB$1=new Vector3,_vC$1=new Vector3,_tempA=new Vector3,_morphA=new Vector3,_uvA$1=new Vector2,_uvB$1=new Vector2,_uvC$1=new Vector2,_normalA=new Vector3,_normalB=new Vector3,_normalC=new Vector3,_intersectionPoint=new Vector3,_intersectionPointWorld=new Vector3;class Mesh extends Object3D{constructor(e=new BufferGeometry,a=new MeshBasicMaterial){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=a,this.updateMorphTargets()}copy(e,a){return super.copy(e,a),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const a=this.geometry.morphAttributes,o=Object.keys(a);if(o.length>0){const c=a[o[0]];if(c!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let d=0,g=c.length;d<g;d++){const _=c[d].name||String(d);this.morphTargetInfluences.push(0),this.morphTargetDictionary[_]=d}}}}getVertexPosition(e,a){const o=this.geometry,c=o.attributes.position,d=o.morphAttributes.position,g=o.morphTargetsRelative;a.fromBufferAttribute(c,e);const _=this.morphTargetInfluences;if(d&&_){_morphA.set(0,0,0);for(let b=0,$=d.length;b<$;b++){const tt=_[b],rt=d[b];tt!==0&&(_tempA.fromBufferAttribute(rt,e),g?_morphA.addScaledVector(_tempA,tt):_morphA.addScaledVector(_tempA.sub(a),tt))}a.add(_morphA)}return a}raycast(e,a){const o=this.geometry,c=this.material,d=this.matrixWorld;c!==void 0&&(o.boundingSphere===null&&o.computeBoundingSphere(),_sphere$6.copy(o.boundingSphere),_sphere$6.applyMatrix4(d),_ray$3.copy(e.ray).recast(e.near),!(_sphere$6.containsPoint(_ray$3.origin)===!1&&(_ray$3.intersectSphere(_sphere$6,_sphereHitAt)===null||_ray$3.origin.distanceToSquared(_sphereHitAt)>(e.far-e.near)**2))&&(_inverseMatrix$3.copy(d).invert(),_ray$3.copy(e.ray).applyMatrix4(_inverseMatrix$3),!(o.boundingBox!==null&&_ray$3.intersectsBox(o.boundingBox)===!1)&&this._computeIntersections(e,a,_ray$3)))}_computeIntersections(e,a,o){let c;const d=this.geometry,g=this.material,_=d.index,b=d.attributes.position,$=d.attributes.uv,tt=d.attributes.uv1,rt=d.attributes.normal,et=d.groups,st=d.drawRange;if(_!==null)if(Array.isArray(g))for(let ot=0,at=et.length;ot<at;ot++){const lt=et[ot],_e=g[lt.materialIndex],it=Math.max(lt.start,st.start),nt=Math.min(_.count,Math.min(lt.start+lt.count,st.start+st.count));for(let ct=it,ht=nt;ct<ht;ct+=3){const ft=_.getX(ct),pt=_.getX(ct+1),yt=_.getX(ct+2);c=checkGeometryIntersection(this,_e,e,o,$,tt,rt,ft,pt,yt),c&&(c.faceIndex=Math.floor(ct/3),c.face.materialIndex=lt.materialIndex,a.push(c))}}else{const ot=Math.max(0,st.start),at=Math.min(_.count,st.start+st.count);for(let lt=ot,_e=at;lt<_e;lt+=3){const it=_.getX(lt),nt=_.getX(lt+1),ct=_.getX(lt+2);c=checkGeometryIntersection(this,g,e,o,$,tt,rt,it,nt,ct),c&&(c.faceIndex=Math.floor(lt/3),a.push(c))}}else if(b!==void 0)if(Array.isArray(g))for(let ot=0,at=et.length;ot<at;ot++){const lt=et[ot],_e=g[lt.materialIndex],it=Math.max(lt.start,st.start),nt=Math.min(b.count,Math.min(lt.start+lt.count,st.start+st.count));for(let ct=it,ht=nt;ct<ht;ct+=3){const ft=ct,pt=ct+1,yt=ct+2;c=checkGeometryIntersection(this,_e,e,o,$,tt,rt,ft,pt,yt),c&&(c.faceIndex=Math.floor(ct/3),c.face.materialIndex=lt.materialIndex,a.push(c))}}else{const ot=Math.max(0,st.start),at=Math.min(b.count,st.start+st.count);for(let lt=ot,_e=at;lt<_e;lt+=3){const it=lt,nt=lt+1,ct=lt+2;c=checkGeometryIntersection(this,g,e,o,$,tt,rt,it,nt,ct),c&&(c.faceIndex=Math.floor(lt/3),a.push(c))}}}}function checkIntersection(s,e,a,o,c,d,g,_){let b;if(e.side===BackSide?b=o.intersectTriangle(g,d,c,!0,_):b=o.intersectTriangle(c,d,g,e.side===FrontSide,_),b===null)return null;_intersectionPointWorld.copy(_),_intersectionPointWorld.applyMatrix4(s.matrixWorld);const $=a.ray.origin.distanceTo(_intersectionPointWorld);return $<a.near||$>a.far?null:{distance:$,point:_intersectionPointWorld.clone(),object:s}}function checkGeometryIntersection(s,e,a,o,c,d,g,_,b,$){s.getVertexPosition(_,_vA$1),s.getVertexPosition(b,_vB$1),s.getVertexPosition($,_vC$1);const tt=checkIntersection(s,e,a,o,_vA$1,_vB$1,_vC$1,_intersectionPoint);if(tt){c&&(_uvA$1.fromBufferAttribute(c,_),_uvB$1.fromBufferAttribute(c,b),_uvC$1.fromBufferAttribute(c,$),tt.uv=Triangle.getInterpolation(_intersectionPoint,_vA$1,_vB$1,_vC$1,_uvA$1,_uvB$1,_uvC$1,new Vector2)),d&&(_uvA$1.fromBufferAttribute(d,_),_uvB$1.fromBufferAttribute(d,b),_uvC$1.fromBufferAttribute(d,$),tt.uv1=Triangle.getInterpolation(_intersectionPoint,_vA$1,_vB$1,_vC$1,_uvA$1,_uvB$1,_uvC$1,new Vector2)),g&&(_normalA.fromBufferAttribute(g,_),_normalB.fromBufferAttribute(g,b),_normalC.fromBufferAttribute(g,$),tt.normal=Triangle.getInterpolation(_intersectionPoint,_vA$1,_vB$1,_vC$1,_normalA,_normalB,_normalC,new Vector3),tt.normal.dot(o.direction)>0&&tt.normal.multiplyScalar(-1));const rt={a:_,b,c:$,normal:new Vector3,materialIndex:0};Triangle.getNormal(_vA$1,_vB$1,_vC$1,rt.normal),tt.face=rt}return tt}class BoxGeometry extends BufferGeometry{constructor(e=1,a=1,o=1,c=1,d=1,g=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:a,depth:o,widthSegments:c,heightSegments:d,depthSegments:g};const _=this;c=Math.floor(c),d=Math.floor(d),g=Math.floor(g);const b=[],$=[],tt=[],rt=[];let et=0,st=0;ot("z","y","x",-1,-1,o,a,e,g,d,0),ot("z","y","x",1,-1,o,a,-e,g,d,1),ot("x","z","y",1,1,e,o,a,c,g,2),ot("x","z","y",1,-1,e,o,-a,c,g,3),ot("x","y","z",1,-1,e,a,o,c,d,4),ot("x","y","z",-1,-1,e,a,-o,c,d,5),this.setIndex(b),this.setAttribute("position",new Float32BufferAttribute($,3)),this.setAttribute("normal",new Float32BufferAttribute(tt,3)),this.setAttribute("uv",new Float32BufferAttribute(rt,2));function ot(at,lt,_e,it,nt,ct,ht,ft,pt,yt,vt){const gt=ct/pt,Ct=ht/yt,Pt=ct/2,Tt=ht/2,Rt=ft/2,wt=pt+1,_t=yt+1;let St=0,ut=0;const dt=new Vector3;for(let Mt=0;Mt<_t;Mt++){const At=Mt*Ct-Tt;for(let Bt=0;Bt<wt;Bt++){const Xt=Bt*gt-Pt;dt[at]=Xt*it,dt[lt]=At*nt,dt[_e]=Rt,$.push(dt.x,dt.y,dt.z),dt[at]=0,dt[lt]=0,dt[_e]=ft>0?1:-1,tt.push(dt.x,dt.y,dt.z),rt.push(Bt/pt),rt.push(1-Mt/yt),St+=1}}for(let Mt=0;Mt<yt;Mt++)for(let At=0;At<pt;At++){const Bt=et+At+wt*Mt,Xt=et+At+wt*(Mt+1),It=et+(At+1)+wt*(Mt+1),Vt=et+(At+1)+wt*Mt;b.push(Bt,Xt,Vt),b.push(Xt,It,Vt),ut+=6}_.addGroup(st,ut,vt),st+=ut,et+=St}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new BoxGeometry(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function cloneUniforms(s){const e={};for(const a in s){e[a]={};for(const o in s[a]){const c=s[a][o];c&&(c.isColor||c.isMatrix3||c.isMatrix4||c.isVector2||c.isVector3||c.isVector4||c.isTexture||c.isQuaternion)?c.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[a][o]=null):e[a][o]=c.clone():Array.isArray(c)?e[a][o]=c.slice():e[a][o]=c}}return e}function mergeUniforms(s){const e={};for(let a=0;a<s.length;a++){const o=cloneUniforms(s[a]);for(const c in o)e[c]=o[c]}return e}function cloneUniformsGroups(s){const e=[];for(let a=0;a<s.length;a++)e.push(s[a].clone());return e}function getUnlitUniformColorSpace(s){const e=s.getRenderTarget();return e===null?s.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:ColorManagement.workingColorSpace}const UniformsUtils={clone:cloneUniforms,merge:mergeUniforms};var default_vertex=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,default_fragment=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class ShaderMaterial extends Material{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=default_vertex,this.fragmentShader=default_fragment,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=cloneUniforms(e.uniforms),this.uniformsGroups=cloneUniformsGroups(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const a=super.toJSON(e);a.glslVersion=this.glslVersion,a.uniforms={};for(const c in this.uniforms){const g=this.uniforms[c].value;g&&g.isTexture?a.uniforms[c]={type:"t",value:g.toJSON(e).uuid}:g&&g.isColor?a.uniforms[c]={type:"c",value:g.getHex()}:g&&g.isVector2?a.uniforms[c]={type:"v2",value:g.toArray()}:g&&g.isVector3?a.uniforms[c]={type:"v3",value:g.toArray()}:g&&g.isVector4?a.uniforms[c]={type:"v4",value:g.toArray()}:g&&g.isMatrix3?a.uniforms[c]={type:"m3",value:g.toArray()}:g&&g.isMatrix4?a.uniforms[c]={type:"m4",value:g.toArray()}:a.uniforms[c]={value:g}}Object.keys(this.defines).length>0&&(a.defines=this.defines),a.vertexShader=this.vertexShader,a.fragmentShader=this.fragmentShader,a.lights=this.lights,a.clipping=this.clipping;const o={};for(const c in this.extensions)this.extensions[c]===!0&&(o[c]=!0);return Object.keys(o).length>0&&(a.extensions=o),a}}class Camera extends Object3D{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Matrix4,this.projectionMatrix=new Matrix4,this.projectionMatrixInverse=new Matrix4,this.coordinateSystem=WebGLCoordinateSystem}copy(e,a){return super.copy(e,a),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,a){super.updateWorldMatrix(e,a),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const _v3$1=new Vector3,_minTarget=new Vector2,_maxTarget=new Vector2;class PerspectiveCamera extends Camera{constructor(e=50,a=1,o=.1,c=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=o,this.far=c,this.focus=10,this.aspect=a,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,a){return super.copy(e,a),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const a=.5*this.getFilmHeight()/e;this.fov=RAD2DEG*2*Math.atan(a),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(DEG2RAD*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return RAD2DEG*2*Math.atan(Math.tan(DEG2RAD*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,a,o){_v3$1.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),a.set(_v3$1.x,_v3$1.y).multiplyScalar(-e/_v3$1.z),_v3$1.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),o.set(_v3$1.x,_v3$1.y).multiplyScalar(-e/_v3$1.z)}getViewSize(e,a){return this.getViewBounds(e,_minTarget,_maxTarget),a.subVectors(_maxTarget,_minTarget)}setViewOffset(e,a,o,c,d,g){this.aspect=e/a,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=a,this.view.offsetX=o,this.view.offsetY=c,this.view.width=d,this.view.height=g,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let a=e*Math.tan(DEG2RAD*.5*this.fov)/this.zoom,o=2*a,c=this.aspect*o,d=-.5*c;const g=this.view;if(this.view!==null&&this.view.enabled){const b=g.fullWidth,$=g.fullHeight;d+=g.offsetX*c/b,a-=g.offsetY*o/$,c*=g.width/b,o*=g.height/$}const _=this.filmOffset;_!==0&&(d+=e*_/this.getFilmWidth()),this.projectionMatrix.makePerspective(d,d+c,a,a-o,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const a=super.toJSON(e);return a.object.fov=this.fov,a.object.zoom=this.zoom,a.object.near=this.near,a.object.far=this.far,a.object.focus=this.focus,a.object.aspect=this.aspect,this.view!==null&&(a.object.view=Object.assign({},this.view)),a.object.filmGauge=this.filmGauge,a.object.filmOffset=this.filmOffset,a}}const fov=-90,aspect=1;class CubeCamera extends Object3D{constructor(e,a,o){super(),this.type="CubeCamera",this.renderTarget=o,this.coordinateSystem=null,this.activeMipmapLevel=0;const c=new PerspectiveCamera(fov,aspect,e,a);c.layers=this.layers,this.add(c);const d=new PerspectiveCamera(fov,aspect,e,a);d.layers=this.layers,this.add(d);const g=new PerspectiveCamera(fov,aspect,e,a);g.layers=this.layers,this.add(g);const _=new PerspectiveCamera(fov,aspect,e,a);_.layers=this.layers,this.add(_);const b=new PerspectiveCamera(fov,aspect,e,a);b.layers=this.layers,this.add(b);const $=new PerspectiveCamera(fov,aspect,e,a);$.layers=this.layers,this.add($)}updateCoordinateSystem(){const e=this.coordinateSystem,a=this.children.concat(),[o,c,d,g,_,b]=a;for(const $ of a)this.remove($);if(e===WebGLCoordinateSystem)o.up.set(0,1,0),o.lookAt(1,0,0),c.up.set(0,1,0),c.lookAt(-1,0,0),d.up.set(0,0,-1),d.lookAt(0,1,0),g.up.set(0,0,1),g.lookAt(0,-1,0),_.up.set(0,1,0),_.lookAt(0,0,1),b.up.set(0,1,0),b.lookAt(0,0,-1);else if(e===WebGPUCoordinateSystem)o.up.set(0,-1,0),o.lookAt(-1,0,0),c.up.set(0,-1,0),c.lookAt(1,0,0),d.up.set(0,0,1),d.lookAt(0,1,0),g.up.set(0,0,-1),g.lookAt(0,-1,0),_.up.set(0,-1,0),_.lookAt(0,0,1),b.up.set(0,-1,0),b.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const $ of a)this.add($),$.updateMatrixWorld()}update(e,a){this.parent===null&&this.updateMatrixWorld();const{renderTarget:o,activeMipmapLevel:c}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[d,g,_,b,$,tt]=this.children,rt=e.getRenderTarget(),et=e.getActiveCubeFace(),st=e.getActiveMipmapLevel(),ot=e.xr.enabled;e.xr.enabled=!1;const at=o.texture.generateMipmaps;o.texture.generateMipmaps=!1,e.setRenderTarget(o,0,c),e.render(a,d),e.setRenderTarget(o,1,c),e.render(a,g),e.setRenderTarget(o,2,c),e.render(a,_),e.setRenderTarget(o,3,c),e.render(a,b),e.setRenderTarget(o,4,c),e.render(a,$),o.texture.generateMipmaps=at,e.setRenderTarget(o,5,c),e.render(a,tt),e.setRenderTarget(rt,et,st),e.xr.enabled=ot,o.texture.needsPMREMUpdate=!0}}class CubeTexture extends Texture{constructor(e,a,o,c,d,g,_,b,$,tt){e=e!==void 0?e:[],a=a!==void 0?a:CubeReflectionMapping,super(e,a,o,c,d,g,_,b,$,tt),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class WebGLCubeRenderTarget extends WebGLRenderTarget{constructor(e=1,a={}){super(e,e,a),this.isWebGLCubeRenderTarget=!0;const o={width:e,height:e,depth:1},c=[o,o,o,o,o,o];this.texture=new CubeTexture(c,a.mapping,a.wrapS,a.wrapT,a.magFilter,a.minFilter,a.format,a.type,a.anisotropy,a.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=a.generateMipmaps!==void 0?a.generateMipmaps:!1,this.texture.minFilter=a.minFilter!==void 0?a.minFilter:LinearFilter}fromEquirectangularTexture(e,a){this.texture.type=a.type,this.texture.colorSpace=a.colorSpace,this.texture.generateMipmaps=a.generateMipmaps,this.texture.minFilter=a.minFilter,this.texture.magFilter=a.magFilter;const o={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},c=new BoxGeometry(5,5,5),d=new ShaderMaterial({name:"CubemapFromEquirect",uniforms:cloneUniforms(o.uniforms),vertexShader:o.vertexShader,fragmentShader:o.fragmentShader,side:BackSide,blending:NoBlending});d.uniforms.tEquirect.value=a;const g=new Mesh(c,d),_=a.minFilter;return a.minFilter===LinearMipmapLinearFilter&&(a.minFilter=LinearFilter),new CubeCamera(1,10,this).update(e,g),a.minFilter=_,g.geometry.dispose(),g.material.dispose(),this}clear(e,a,o,c){const d=e.getRenderTarget();for(let g=0;g<6;g++)e.setRenderTarget(this,g),e.clear(a,o,c);e.setRenderTarget(d)}}const _vector1=new Vector3,_vector2=new Vector3,_normalMatrix=new Matrix3;class Plane{constructor(e=new Vector3(1,0,0),a=0){this.isPlane=!0,this.normal=e,this.constant=a}set(e,a){return this.normal.copy(e),this.constant=a,this}setComponents(e,a,o,c){return this.normal.set(e,a,o),this.constant=c,this}setFromNormalAndCoplanarPoint(e,a){return this.normal.copy(e),this.constant=-a.dot(this.normal),this}setFromCoplanarPoints(e,a,o){const c=_vector1.subVectors(o,a).cross(_vector2.subVectors(e,a)).normalize();return this.setFromNormalAndCoplanarPoint(c,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,a){return a.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,a){const o=e.delta(_vector1),c=this.normal.dot(o);if(c===0)return this.distanceToPoint(e.start)===0?a.copy(e.start):null;const d=-(e.start.dot(this.normal)+this.constant)/c;return d<0||d>1?null:a.copy(e.start).addScaledVector(o,d)}intersectsLine(e){const a=this.distanceToPoint(e.start),o=this.distanceToPoint(e.end);return a<0&&o>0||o<0&&a>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,a){const o=a||_normalMatrix.getNormalMatrix(e),c=this.coplanarPoint(_vector1).applyMatrix4(e),d=this.normal.applyMatrix3(o).normalize();return this.constant=-c.dot(d),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const _sphere$5=new Sphere,_vector$7=new Vector3;class Frustum{constructor(e=new Plane,a=new Plane,o=new Plane,c=new Plane,d=new Plane,g=new Plane){this.planes=[e,a,o,c,d,g]}set(e,a,o,c,d,g){const _=this.planes;return _[0].copy(e),_[1].copy(a),_[2].copy(o),_[3].copy(c),_[4].copy(d),_[5].copy(g),this}copy(e){const a=this.planes;for(let o=0;o<6;o++)a[o].copy(e.planes[o]);return this}setFromProjectionMatrix(e,a=WebGLCoordinateSystem){const o=this.planes,c=e.elements,d=c[0],g=c[1],_=c[2],b=c[3],$=c[4],tt=c[5],rt=c[6],et=c[7],st=c[8],ot=c[9],at=c[10],lt=c[11],_e=c[12],it=c[13],nt=c[14],ct=c[15];if(o[0].setComponents(b-d,et-$,lt-st,ct-_e).normalize(),o[1].setComponents(b+d,et+$,lt+st,ct+_e).normalize(),o[2].setComponents(b+g,et+tt,lt+ot,ct+it).normalize(),o[3].setComponents(b-g,et-tt,lt-ot,ct-it).normalize(),o[4].setComponents(b-_,et-rt,lt-at,ct-nt).normalize(),a===WebGLCoordinateSystem)o[5].setComponents(b+_,et+rt,lt+at,ct+nt).normalize();else if(a===WebGPUCoordinateSystem)o[5].setComponents(_,rt,at,nt).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+a);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),_sphere$5.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const a=e.geometry;a.boundingSphere===null&&a.computeBoundingSphere(),_sphere$5.copy(a.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(_sphere$5)}intersectsSprite(e){return _sphere$5.center.set(0,0,0),_sphere$5.radius=.7071067811865476,_sphere$5.applyMatrix4(e.matrixWorld),this.intersectsSphere(_sphere$5)}intersectsSphere(e){const a=this.planes,o=e.center,c=-e.radius;for(let d=0;d<6;d++)if(a[d].distanceToPoint(o)<c)return!1;return!0}intersectsBox(e){const a=this.planes;for(let o=0;o<6;o++){const c=a[o];if(_vector$7.x=c.normal.x>0?e.max.x:e.min.x,_vector$7.y=c.normal.y>0?e.max.y:e.min.y,_vector$7.z=c.normal.z>0?e.max.z:e.min.z,c.distanceToPoint(_vector$7)<0)return!1}return!0}containsPoint(e){const a=this.planes;for(let o=0;o<6;o++)if(a[o].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function WebGLAnimation(){let s=null,e=!1,a=null,o=null;function c(d,g){a(d,g),o=s.requestAnimationFrame(c)}return{start:function(){e!==!0&&a!==null&&(o=s.requestAnimationFrame(c),e=!0)},stop:function(){s.cancelAnimationFrame(o),e=!1},setAnimationLoop:function(d){a=d},setContext:function(d){s=d}}}function WebGLAttributes(s){const e=new WeakMap;function a(_,b){const $=_.array,tt=_.usage,rt=$.byteLength,et=s.createBuffer();s.bindBuffer(b,et),s.bufferData(b,$,tt),_.onUploadCallback();let st;if($ instanceof Float32Array)st=s.FLOAT;else if($ instanceof Uint16Array)_.isFloat16BufferAttribute?st=s.HALF_FLOAT:st=s.UNSIGNED_SHORT;else if($ instanceof Int16Array)st=s.SHORT;else if($ instanceof Uint32Array)st=s.UNSIGNED_INT;else if($ instanceof Int32Array)st=s.INT;else if($ instanceof Int8Array)st=s.BYTE;else if($ instanceof Uint8Array)st=s.UNSIGNED_BYTE;else if($ instanceof Uint8ClampedArray)st=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+$);return{buffer:et,type:st,bytesPerElement:$.BYTES_PER_ELEMENT,version:_.version,size:rt}}function o(_,b,$){const tt=b.array,rt=b._updateRange,et=b.updateRanges;if(s.bindBuffer($,_),rt.count===-1&&et.length===0&&s.bufferSubData($,0,tt),et.length!==0){for(let st=0,ot=et.length;st<ot;st++){const at=et[st];s.bufferSubData($,at.start*tt.BYTES_PER_ELEMENT,tt,at.start,at.count)}b.clearUpdateRanges()}rt.count!==-1&&(s.bufferSubData($,rt.offset*tt.BYTES_PER_ELEMENT,tt,rt.offset,rt.count),rt.count=-1),b.onUploadCallback()}function c(_){return _.isInterleavedBufferAttribute&&(_=_.data),e.get(_)}function d(_){_.isInterleavedBufferAttribute&&(_=_.data);const b=e.get(_);b&&(s.deleteBuffer(b.buffer),e.delete(_))}function g(_,b){if(_.isGLBufferAttribute){const tt=e.get(_);(!tt||tt.version<_.version)&&e.set(_,{buffer:_.buffer,type:_.type,bytesPerElement:_.elementSize,version:_.version});return}_.isInterleavedBufferAttribute&&(_=_.data);const $=e.get(_);if($===void 0)e.set(_,a(_,b));else if($.version<_.version){if($.size!==_.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");o($.buffer,_,b),$.version=_.version}}return{get:c,remove:d,update:g}}class PlaneGeometry extends BufferGeometry{constructor(e=1,a=1,o=1,c=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:a,widthSegments:o,heightSegments:c};const d=e/2,g=a/2,_=Math.floor(o),b=Math.floor(c),$=_+1,tt=b+1,rt=e/_,et=a/b,st=[],ot=[],at=[],lt=[];for(let _e=0;_e<tt;_e++){const it=_e*et-g;for(let nt=0;nt<$;nt++){const ct=nt*rt-d;ot.push(ct,-it,0),at.push(0,0,1),lt.push(nt/_),lt.push(1-_e/b)}}for(let _e=0;_e<b;_e++)for(let it=0;it<_;it++){const nt=it+$*_e,ct=it+$*(_e+1),ht=it+1+$*(_e+1),ft=it+1+$*_e;st.push(nt,ct,ft),st.push(ct,ht,ft)}this.setIndex(st),this.setAttribute("position",new Float32BufferAttribute(ot,3)),this.setAttribute("normal",new Float32BufferAttribute(at,3)),this.setAttribute("uv",new Float32BufferAttribute(lt,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new PlaneGeometry(e.width,e.height,e.widthSegments,e.heightSegments)}}var alphahash_fragment=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,alphahash_pars_fragment=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,alphamap_fragment=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,alphamap_pars_fragment=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,alphatest_fragment=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,alphatest_pars_fragment=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,aomap_fragment=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,aomap_pars_fragment=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,batching_pars_vertex=`#ifdef USE_BATCHING
	attribute float batchId;
	uniform highp sampler2D batchingTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,batching_vertex=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( batchId );
#endif`,begin_vertex=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,beginnormal_vertex=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bsdfs=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,iridescence_fragment=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,bumpmap_pars_fragment=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,clipping_planes_fragment=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,clipping_planes_pars_fragment=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,clipping_planes_pars_vertex=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,clipping_planes_vertex=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,color_fragment=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,color_pars_fragment=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,color_pars_vertex=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	varying vec3 vColor;
#endif`,color_vertex=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif`,common=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
float luminance( const in vec3 rgb ) {
	const vec3 weights = vec3( 0.2126729, 0.7151522, 0.0721750 );
	return dot( weights, rgb );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,cube_uv_reflection_fragment=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,defaultnormal_vertex=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,displacementmap_pars_vertex=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,displacementmap_vertex=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,emissivemap_fragment=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,emissivemap_pars_fragment=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,colorspace_fragment="gl_FragColor = linearToOutputTexel( gl_FragColor );",colorspace_pars_fragment=`
const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 LinearToLinear( in vec4 value ) {
	return value;
}
vec4 LinearTosRGB( in vec4 value ) {
	return sRGBTransferOETF( value );
}`,envmap_fragment=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,envmap_common_pars_fragment=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,envmap_pars_fragment=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,envmap_pars_vertex=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,envmap_vertex=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fog_vertex=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,fog_pars_vertex=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fog_fragment=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,fog_pars_fragment=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,gradientmap_pars_fragment=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,lightmap_fragment=`#ifdef USE_LIGHTMAP
	vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
	vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
	reflectedLight.indirectDiffuse += lightMapIrradiance;
#endif`,lightmap_pars_fragment=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lights_lambert_fragment=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,lights_lambert_pars_fragment=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,lights_pars_begin=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	#if defined ( LEGACY_LIGHTS )
		if ( cutoffDistance > 0.0 && decayExponent > 0.0 ) {
			return pow( saturate( - lightDistance / cutoffDistance + 1.0 ), decayExponent );
		}
		return 1.0;
	#else
		float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
		if ( cutoffDistance > 0.0 ) {
			distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
		}
		return distanceFalloff;
	#endif
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,envmap_physical_pars_fragment=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,lights_toon_fragment=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lights_toon_pars_fragment=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lights_phong_fragment=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lights_phong_pars_fragment=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lights_physical_fragment=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,lights_physical_pars_fragment=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,lights_fragment_begin=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lights_fragment_maps=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,lights_fragment_end=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,logdepthbuf_fragment=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,logdepthbuf_pars_fragment=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_pars_vertex=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_vertex=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,map_fragment=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,map_pars_fragment=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,map_particle_fragment=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,map_particle_pars_fragment=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,metalnessmap_fragment=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,metalnessmap_pars_fragment=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,morphinstance_vertex=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[MORPHTARGETS_COUNT];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,morphcolor_vertex=`#if defined( USE_MORPHCOLORS ) && defined( MORPHTARGETS_TEXTURE )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,morphnormal_vertex=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
			if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
		}
	#else
		objectNormal += morphNormal0 * morphTargetInfluences[ 0 ];
		objectNormal += morphNormal1 * morphTargetInfluences[ 1 ];
		objectNormal += morphNormal2 * morphTargetInfluences[ 2 ];
		objectNormal += morphNormal3 * morphTargetInfluences[ 3 ];
	#endif
#endif`,morphtarget_pars_vertex=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
	#endif
	#ifdef MORPHTARGETS_TEXTURE
		#ifndef USE_INSTANCING_MORPH
			uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
		#endif
		uniform sampler2DArray morphTargetsTexture;
		uniform ivec2 morphTargetsTextureSize;
		vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
			int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
			int y = texelIndex / morphTargetsTextureSize.x;
			int x = texelIndex - y * morphTargetsTextureSize.x;
			ivec3 morphUV = ivec3( x, y, morphTargetIndex );
			return texelFetch( morphTargetsTexture, morphUV, 0 );
		}
	#else
		#ifndef USE_MORPHNORMALS
			uniform float morphTargetInfluences[ 8 ];
		#else
			uniform float morphTargetInfluences[ 4 ];
		#endif
	#endif
#endif`,morphtarget_vertex=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
			if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
		}
	#else
		transformed += morphTarget0 * morphTargetInfluences[ 0 ];
		transformed += morphTarget1 * morphTargetInfluences[ 1 ];
		transformed += morphTarget2 * morphTargetInfluences[ 2 ];
		transformed += morphTarget3 * morphTargetInfluences[ 3 ];
		#ifndef USE_MORPHNORMALS
			transformed += morphTarget4 * morphTargetInfluences[ 4 ];
			transformed += morphTarget5 * morphTargetInfluences[ 5 ];
			transformed += morphTarget6 * morphTargetInfluences[ 6 ];
			transformed += morphTarget7 * morphTargetInfluences[ 7 ];
		#endif
	#endif
#endif`,normal_fragment_begin=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,normal_fragment_maps=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,normal_pars_fragment=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_pars_vertex=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_vertex=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,normalmap_pars_fragment=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,clearcoat_normal_fragment_begin=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,clearcoat_normal_fragment_maps=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,clearcoat_pars_fragment=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,iridescence_pars_fragment=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,opaque_fragment=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,packing=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;
const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );
const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );
const float ShiftRight8 = 1. / 256.;
vec4 packDepthToRGBA( const in float v ) {
	vec4 r = vec4( fract( v * PackFactors ), v );
	r.yzw -= r.xyz * ShiftRight8;	return r * PackUpscale;
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors );
}
vec2 packDepthToRG( in highp float v ) {
	return packDepthToRGBA( v ).yx;
}
float unpackRGToDepth( const in highp vec2 v ) {
	return unpackRGBAToDepth( vec4( v.xy, 0.0, 0.0 ) );
}
vec4 pack2HalfToRGBA( vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,premultiplied_alpha_fragment=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,project_vertex=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dithering_fragment=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,dithering_pars_fragment=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,roughnessmap_fragment=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,roughnessmap_pars_fragment=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,shadowmap_pars_fragment=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return shadow;
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return shadow;
	}
#endif`,shadowmap_pars_vertex=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,shadowmap_vertex=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,shadowmask_pars_fragment=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,skinbase_vertex=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,skinning_pars_vertex=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,skinning_vertex=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,skinnormal_vertex=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,specularmap_fragment=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,specularmap_pars_fragment=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,tonemapping_fragment=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,tonemapping_pars_fragment=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 OptimizedCineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	float startCompression = 0.8 - 0.04;
	float desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min(color.r, min(color.g, color.b));
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max(color.r, max(color.g, color.b));
	if (peak < startCompression) return color;
	float d = 1. - startCompression;
	float newPeak = 1. - d * d / (peak + d - startCompression);
	color *= newPeak / peak;
	float g = 1. - 1. / (desaturation * (peak - newPeak) + 1.);
	return mix(color, newPeak * vec3(1, 1, 1), g);
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,transmission_fragment=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,transmission_pars_fragment=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
		vec3 refractedRayExit = position + transmissionRay;
		vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
		vec2 refractionCoords = ndcPos.xy / ndcPos.w;
		refractionCoords += 1.0;
		refractionCoords /= 2.0;
		vec4 transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
		vec3 transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,uv_pars_fragment=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_pars_vertex=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_vertex=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,worldpos_vertex=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const vertex$h=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,fragment$h=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,vertex$g=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,fragment$g=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,vertex$f=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,fragment$f=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,vertex$e=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,fragment$e=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#endif
}`,vertex$d=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,fragment$d=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,vertex$c=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,fragment$c=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,vertex$b=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,fragment$b=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,vertex$a=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,fragment$a=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vertex$9=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,fragment$9=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vertex$8=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,fragment$8=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vertex$7=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,fragment$7=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,vertex$6=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,fragment$6=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vertex$5=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,fragment$5=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vertex$4=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,fragment$4=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vertex$3=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,fragment$3=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,vertex$2=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,fragment$2=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,vertex$1=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec2 scale;
	scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
	scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,fragment$1=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,ShaderChunk={alphahash_fragment,alphahash_pars_fragment,alphamap_fragment,alphamap_pars_fragment,alphatest_fragment,alphatest_pars_fragment,aomap_fragment,aomap_pars_fragment,batching_pars_vertex,batching_vertex,begin_vertex,beginnormal_vertex,bsdfs,iridescence_fragment,bumpmap_pars_fragment,clipping_planes_fragment,clipping_planes_pars_fragment,clipping_planes_pars_vertex,clipping_planes_vertex,color_fragment,color_pars_fragment,color_pars_vertex,color_vertex,common,cube_uv_reflection_fragment,defaultnormal_vertex,displacementmap_pars_vertex,displacementmap_vertex,emissivemap_fragment,emissivemap_pars_fragment,colorspace_fragment,colorspace_pars_fragment,envmap_fragment,envmap_common_pars_fragment,envmap_pars_fragment,envmap_pars_vertex,envmap_physical_pars_fragment,envmap_vertex,fog_vertex,fog_pars_vertex,fog_fragment,fog_pars_fragment,gradientmap_pars_fragment,lightmap_fragment,lightmap_pars_fragment,lights_lambert_fragment,lights_lambert_pars_fragment,lights_pars_begin,lights_toon_fragment,lights_toon_pars_fragment,lights_phong_fragment,lights_phong_pars_fragment,lights_physical_fragment,lights_physical_pars_fragment,lights_fragment_begin,lights_fragment_maps,lights_fragment_end,logdepthbuf_fragment,logdepthbuf_pars_fragment,logdepthbuf_pars_vertex,logdepthbuf_vertex,map_fragment,map_pars_fragment,map_particle_fragment,map_particle_pars_fragment,metalnessmap_fragment,metalnessmap_pars_fragment,morphinstance_vertex,morphcolor_vertex,morphnormal_vertex,morphtarget_pars_vertex,morphtarget_vertex,normal_fragment_begin,normal_fragment_maps,normal_pars_fragment,normal_pars_vertex,normal_vertex,normalmap_pars_fragment,clearcoat_normal_fragment_begin,clearcoat_normal_fragment_maps,clearcoat_pars_fragment,iridescence_pars_fragment,opaque_fragment,packing,premultiplied_alpha_fragment,project_vertex,dithering_fragment,dithering_pars_fragment,roughnessmap_fragment,roughnessmap_pars_fragment,shadowmap_pars_fragment,shadowmap_pars_vertex,shadowmap_vertex,shadowmask_pars_fragment,skinbase_vertex,skinning_pars_vertex,skinning_vertex,skinnormal_vertex,specularmap_fragment,specularmap_pars_fragment,tonemapping_fragment,tonemapping_pars_fragment,transmission_fragment,transmission_pars_fragment,uv_pars_fragment,uv_pars_vertex,uv_vertex,worldpos_vertex,background_vert:vertex$h,background_frag:fragment$h,backgroundCube_vert:vertex$g,backgroundCube_frag:fragment$g,cube_vert:vertex$f,cube_frag:fragment$f,depth_vert:vertex$e,depth_frag:fragment$e,distanceRGBA_vert:vertex$d,distanceRGBA_frag:fragment$d,equirect_vert:vertex$c,equirect_frag:fragment$c,linedashed_vert:vertex$b,linedashed_frag:fragment$b,meshbasic_vert:vertex$a,meshbasic_frag:fragment$a,meshlambert_vert:vertex$9,meshlambert_frag:fragment$9,meshmatcap_vert:vertex$8,meshmatcap_frag:fragment$8,meshnormal_vert:vertex$7,meshnormal_frag:fragment$7,meshphong_vert:vertex$6,meshphong_frag:fragment$6,meshphysical_vert:vertex$5,meshphysical_frag:fragment$5,meshtoon_vert:vertex$4,meshtoon_frag:fragment$4,points_vert:vertex$3,points_frag:fragment$3,shadow_vert:vertex$2,shadow_frag:fragment$2,sprite_vert:vertex$1,sprite_frag:fragment$1},UniformsLib={common:{diffuse:{value:new Color(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Matrix3},alphaMap:{value:null},alphaMapTransform:{value:new Matrix3},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Matrix3}},envmap:{envMap:{value:null},envMapRotation:{value:new Matrix3},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Matrix3}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Matrix3}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Matrix3},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Matrix3},normalScale:{value:new Vector2(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Matrix3},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Matrix3}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Matrix3}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Matrix3}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Color(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Color(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Matrix3},alphaTest:{value:0},uvTransform:{value:new Matrix3}},sprite:{diffuse:{value:new Color(16777215)},opacity:{value:1},center:{value:new Vector2(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Matrix3},alphaMap:{value:null},alphaMapTransform:{value:new Matrix3},alphaTest:{value:0}}},ShaderLib={basic:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.specularmap,UniformsLib.envmap,UniformsLib.aomap,UniformsLib.lightmap,UniformsLib.fog]),vertexShader:ShaderChunk.meshbasic_vert,fragmentShader:ShaderChunk.meshbasic_frag},lambert:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.specularmap,UniformsLib.envmap,UniformsLib.aomap,UniformsLib.lightmap,UniformsLib.emissivemap,UniformsLib.bumpmap,UniformsLib.normalmap,UniformsLib.displacementmap,UniformsLib.fog,UniformsLib.lights,{emissive:{value:new Color(0)}}]),vertexShader:ShaderChunk.meshlambert_vert,fragmentShader:ShaderChunk.meshlambert_frag},phong:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.specularmap,UniformsLib.envmap,UniformsLib.aomap,UniformsLib.lightmap,UniformsLib.emissivemap,UniformsLib.bumpmap,UniformsLib.normalmap,UniformsLib.displacementmap,UniformsLib.fog,UniformsLib.lights,{emissive:{value:new Color(0)},specular:{value:new Color(1118481)},shininess:{value:30}}]),vertexShader:ShaderChunk.meshphong_vert,fragmentShader:ShaderChunk.meshphong_frag},standard:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.envmap,UniformsLib.aomap,UniformsLib.lightmap,UniformsLib.emissivemap,UniformsLib.bumpmap,UniformsLib.normalmap,UniformsLib.displacementmap,UniformsLib.roughnessmap,UniformsLib.metalnessmap,UniformsLib.fog,UniformsLib.lights,{emissive:{value:new Color(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:ShaderChunk.meshphysical_vert,fragmentShader:ShaderChunk.meshphysical_frag},toon:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.aomap,UniformsLib.lightmap,UniformsLib.emissivemap,UniformsLib.bumpmap,UniformsLib.normalmap,UniformsLib.displacementmap,UniformsLib.gradientmap,UniformsLib.fog,UniformsLib.lights,{emissive:{value:new Color(0)}}]),vertexShader:ShaderChunk.meshtoon_vert,fragmentShader:ShaderChunk.meshtoon_frag},matcap:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.bumpmap,UniformsLib.normalmap,UniformsLib.displacementmap,UniformsLib.fog,{matcap:{value:null}}]),vertexShader:ShaderChunk.meshmatcap_vert,fragmentShader:ShaderChunk.meshmatcap_frag},points:{uniforms:mergeUniforms([UniformsLib.points,UniformsLib.fog]),vertexShader:ShaderChunk.points_vert,fragmentShader:ShaderChunk.points_frag},dashed:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:ShaderChunk.linedashed_vert,fragmentShader:ShaderChunk.linedashed_frag},depth:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.displacementmap]),vertexShader:ShaderChunk.depth_vert,fragmentShader:ShaderChunk.depth_frag},normal:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.bumpmap,UniformsLib.normalmap,UniformsLib.displacementmap,{opacity:{value:1}}]),vertexShader:ShaderChunk.meshnormal_vert,fragmentShader:ShaderChunk.meshnormal_frag},sprite:{uniforms:mergeUniforms([UniformsLib.sprite,UniformsLib.fog]),vertexShader:ShaderChunk.sprite_vert,fragmentShader:ShaderChunk.sprite_frag},background:{uniforms:{uvTransform:{value:new Matrix3},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:ShaderChunk.background_vert,fragmentShader:ShaderChunk.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Matrix3}},vertexShader:ShaderChunk.backgroundCube_vert,fragmentShader:ShaderChunk.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:ShaderChunk.cube_vert,fragmentShader:ShaderChunk.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:ShaderChunk.equirect_vert,fragmentShader:ShaderChunk.equirect_frag},distanceRGBA:{uniforms:mergeUniforms([UniformsLib.common,UniformsLib.displacementmap,{referencePosition:{value:new Vector3},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:ShaderChunk.distanceRGBA_vert,fragmentShader:ShaderChunk.distanceRGBA_frag},shadow:{uniforms:mergeUniforms([UniformsLib.lights,UniformsLib.fog,{color:{value:new Color(0)},opacity:{value:1}}]),vertexShader:ShaderChunk.shadow_vert,fragmentShader:ShaderChunk.shadow_frag}};ShaderLib.physical={uniforms:mergeUniforms([ShaderLib.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Matrix3},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Matrix3},clearcoatNormalScale:{value:new Vector2(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Matrix3},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Matrix3},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Matrix3},sheen:{value:0},sheenColor:{value:new Color(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Matrix3},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Matrix3},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Matrix3},transmissionSamplerSize:{value:new Vector2},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Matrix3},attenuationDistance:{value:0},attenuationColor:{value:new Color(0)},specularColor:{value:new Color(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Matrix3},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Matrix3},anisotropyVector:{value:new Vector2},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Matrix3}}]),vertexShader:ShaderChunk.meshphysical_vert,fragmentShader:ShaderChunk.meshphysical_frag};const _rgb={r:0,b:0,g:0},_e1$1=new Euler,_m1$1=new Matrix4;function WebGLBackground(s,e,a,o,c,d,g){const _=new Color(0);let b=d===!0?0:1,$,tt,rt=null,et=0,st=null;function ot(lt,_e){let it=!1,nt=_e.isScene===!0?_e.background:null;nt&&nt.isTexture&&(nt=(_e.backgroundBlurriness>0?a:e).get(nt)),nt===null?at(_,b):nt&&nt.isColor&&(at(nt,1),it=!0);const ct=s.xr.getEnvironmentBlendMode();ct==="additive"?o.buffers.color.setClear(0,0,0,1,g):ct==="alpha-blend"&&o.buffers.color.setClear(0,0,0,0,g),(s.autoClear||it)&&s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil),nt&&(nt.isCubeTexture||nt.mapping===CubeUVReflectionMapping)?(tt===void 0&&(tt=new Mesh(new BoxGeometry(1,1,1),new ShaderMaterial({name:"BackgroundCubeMaterial",uniforms:cloneUniforms(ShaderLib.backgroundCube.uniforms),vertexShader:ShaderLib.backgroundCube.vertexShader,fragmentShader:ShaderLib.backgroundCube.fragmentShader,side:BackSide,depthTest:!1,depthWrite:!1,fog:!1})),tt.geometry.deleteAttribute("normal"),tt.geometry.deleteAttribute("uv"),tt.onBeforeRender=function(ht,ft,pt){this.matrixWorld.copyPosition(pt.matrixWorld)},Object.defineProperty(tt.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),c.update(tt)),_e1$1.copy(_e.backgroundRotation),_e1$1.x*=-1,_e1$1.y*=-1,_e1$1.z*=-1,nt.isCubeTexture&&nt.isRenderTargetTexture===!1&&(_e1$1.y*=-1,_e1$1.z*=-1),tt.material.uniforms.envMap.value=nt,tt.material.uniforms.flipEnvMap.value=nt.isCubeTexture&&nt.isRenderTargetTexture===!1?-1:1,tt.material.uniforms.backgroundBlurriness.value=_e.backgroundBlurriness,tt.material.uniforms.backgroundIntensity.value=_e.backgroundIntensity,tt.material.uniforms.backgroundRotation.value.setFromMatrix4(_m1$1.makeRotationFromEuler(_e1$1)),tt.material.toneMapped=ColorManagement.getTransfer(nt.colorSpace)!==SRGBTransfer,(rt!==nt||et!==nt.version||st!==s.toneMapping)&&(tt.material.needsUpdate=!0,rt=nt,et=nt.version,st=s.toneMapping),tt.layers.enableAll(),lt.unshift(tt,tt.geometry,tt.material,0,0,null)):nt&&nt.isTexture&&($===void 0&&($=new Mesh(new PlaneGeometry(2,2),new ShaderMaterial({name:"BackgroundMaterial",uniforms:cloneUniforms(ShaderLib.background.uniforms),vertexShader:ShaderLib.background.vertexShader,fragmentShader:ShaderLib.background.fragmentShader,side:FrontSide,depthTest:!1,depthWrite:!1,fog:!1})),$.geometry.deleteAttribute("normal"),Object.defineProperty($.material,"map",{get:function(){return this.uniforms.t2D.value}}),c.update($)),$.material.uniforms.t2D.value=nt,$.material.uniforms.backgroundIntensity.value=_e.backgroundIntensity,$.material.toneMapped=ColorManagement.getTransfer(nt.colorSpace)!==SRGBTransfer,nt.matrixAutoUpdate===!0&&nt.updateMatrix(),$.material.uniforms.uvTransform.value.copy(nt.matrix),(rt!==nt||et!==nt.version||st!==s.toneMapping)&&($.material.needsUpdate=!0,rt=nt,et=nt.version,st=s.toneMapping),$.layers.enableAll(),lt.unshift($,$.geometry,$.material,0,0,null))}function at(lt,_e){lt.getRGB(_rgb,getUnlitUniformColorSpace(s)),o.buffers.color.setClear(_rgb.r,_rgb.g,_rgb.b,_e,g)}return{getClearColor:function(){return _},setClearColor:function(lt,_e=1){_.set(lt),b=_e,at(_,b)},getClearAlpha:function(){return b},setClearAlpha:function(lt){b=lt,at(_,b)},render:ot}}function WebGLBindingStates(s,e){const a=s.getParameter(s.MAX_VERTEX_ATTRIBS),o={},c=et(null);let d=c,g=!1;function _(gt,Ct,Pt,Tt,Rt){let wt=!1;const _t=rt(Tt,Pt,Ct);d!==_t&&(d=_t,$(d.object)),wt=st(gt,Tt,Pt,Rt),wt&&ot(gt,Tt,Pt,Rt),Rt!==null&&e.update(Rt,s.ELEMENT_ARRAY_BUFFER),(wt||g)&&(g=!1,ct(gt,Ct,Pt,Tt),Rt!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,e.get(Rt).buffer))}function b(){return s.createVertexArray()}function $(gt){return s.bindVertexArray(gt)}function tt(gt){return s.deleteVertexArray(gt)}function rt(gt,Ct,Pt){const Tt=Pt.wireframe===!0;let Rt=o[gt.id];Rt===void 0&&(Rt={},o[gt.id]=Rt);let wt=Rt[Ct.id];wt===void 0&&(wt={},Rt[Ct.id]=wt);let _t=wt[Tt];return _t===void 0&&(_t=et(b()),wt[Tt]=_t),_t}function et(gt){const Ct=[],Pt=[],Tt=[];for(let Rt=0;Rt<a;Rt++)Ct[Rt]=0,Pt[Rt]=0,Tt[Rt]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:Ct,enabledAttributes:Pt,attributeDivisors:Tt,object:gt,attributes:{},index:null}}function st(gt,Ct,Pt,Tt){const Rt=d.attributes,wt=Ct.attributes;let _t=0;const St=Pt.getAttributes();for(const ut in St)if(St[ut].location>=0){const Mt=Rt[ut];let At=wt[ut];if(At===void 0&&(ut==="instanceMatrix"&&gt.instanceMatrix&&(At=gt.instanceMatrix),ut==="instanceColor"&&gt.instanceColor&&(At=gt.instanceColor)),Mt===void 0||Mt.attribute!==At||At&&Mt.data!==At.data)return!0;_t++}return d.attributesNum!==_t||d.index!==Tt}function ot(gt,Ct,Pt,Tt){const Rt={},wt=Ct.attributes;let _t=0;const St=Pt.getAttributes();for(const ut in St)if(St[ut].location>=0){let Mt=wt[ut];Mt===void 0&&(ut==="instanceMatrix"&&gt.instanceMatrix&&(Mt=gt.instanceMatrix),ut==="instanceColor"&&gt.instanceColor&&(Mt=gt.instanceColor));const At={};At.attribute=Mt,Mt&&Mt.data&&(At.data=Mt.data),Rt[ut]=At,_t++}d.attributes=Rt,d.attributesNum=_t,d.index=Tt}function at(){const gt=d.newAttributes;for(let Ct=0,Pt=gt.length;Ct<Pt;Ct++)gt[Ct]=0}function lt(gt){_e(gt,0)}function _e(gt,Ct){const Pt=d.newAttributes,Tt=d.enabledAttributes,Rt=d.attributeDivisors;Pt[gt]=1,Tt[gt]===0&&(s.enableVertexAttribArray(gt),Tt[gt]=1),Rt[gt]!==Ct&&(s.vertexAttribDivisor(gt,Ct),Rt[gt]=Ct)}function it(){const gt=d.newAttributes,Ct=d.enabledAttributes;for(let Pt=0,Tt=Ct.length;Pt<Tt;Pt++)Ct[Pt]!==gt[Pt]&&(s.disableVertexAttribArray(Pt),Ct[Pt]=0)}function nt(gt,Ct,Pt,Tt,Rt,wt,_t){_t===!0?s.vertexAttribIPointer(gt,Ct,Pt,Rt,wt):s.vertexAttribPointer(gt,Ct,Pt,Tt,Rt,wt)}function ct(gt,Ct,Pt,Tt){at();const Rt=Tt.attributes,wt=Pt.getAttributes(),_t=Ct.defaultAttributeValues;for(const St in wt){const ut=wt[St];if(ut.location>=0){let dt=Rt[St];if(dt===void 0&&(St==="instanceMatrix"&&gt.instanceMatrix&&(dt=gt.instanceMatrix),St==="instanceColor"&&gt.instanceColor&&(dt=gt.instanceColor)),dt!==void 0){const Mt=dt.normalized,At=dt.itemSize,Bt=e.get(dt);if(Bt===void 0)continue;const Xt=Bt.buffer,It=Bt.type,Vt=Bt.bytesPerElement,Wt=It===s.INT||It===s.UNSIGNED_INT||dt.gpuType===IntType;if(dt.isInterleavedBufferAttribute){const Kt=dt.data,ln=Kt.stride,fn=dt.offset;if(Kt.isInstancedInterleavedBuffer){for(let dn=0;dn<ut.locationSize;dn++)_e(ut.location+dn,Kt.meshPerAttribute);gt.isInstancedMesh!==!0&&Tt._maxInstanceCount===void 0&&(Tt._maxInstanceCount=Kt.meshPerAttribute*Kt.count)}else for(let dn=0;dn<ut.locationSize;dn++)lt(ut.location+dn);s.bindBuffer(s.ARRAY_BUFFER,Xt);for(let dn=0;dn<ut.locationSize;dn++)nt(ut.location+dn,At/ut.locationSize,It,Mt,ln*Vt,(fn+At/ut.locationSize*dn)*Vt,Wt)}else{if(dt.isInstancedBufferAttribute){for(let Kt=0;Kt<ut.locationSize;Kt++)_e(ut.location+Kt,dt.meshPerAttribute);gt.isInstancedMesh!==!0&&Tt._maxInstanceCount===void 0&&(Tt._maxInstanceCount=dt.meshPerAttribute*dt.count)}else for(let Kt=0;Kt<ut.locationSize;Kt++)lt(ut.location+Kt);s.bindBuffer(s.ARRAY_BUFFER,Xt);for(let Kt=0;Kt<ut.locationSize;Kt++)nt(ut.location+Kt,At/ut.locationSize,It,Mt,At*Vt,At/ut.locationSize*Kt*Vt,Wt)}}else if(_t!==void 0){const Mt=_t[St];if(Mt!==void 0)switch(Mt.length){case 2:s.vertexAttrib2fv(ut.location,Mt);break;case 3:s.vertexAttrib3fv(ut.location,Mt);break;case 4:s.vertexAttrib4fv(ut.location,Mt);break;default:s.vertexAttrib1fv(ut.location,Mt)}}}}it()}function ht(){yt();for(const gt in o){const Ct=o[gt];for(const Pt in Ct){const Tt=Ct[Pt];for(const Rt in Tt)tt(Tt[Rt].object),delete Tt[Rt];delete Ct[Pt]}delete o[gt]}}function ft(gt){if(o[gt.id]===void 0)return;const Ct=o[gt.id];for(const Pt in Ct){const Tt=Ct[Pt];for(const Rt in Tt)tt(Tt[Rt].object),delete Tt[Rt];delete Ct[Pt]}delete o[gt.id]}function pt(gt){for(const Ct in o){const Pt=o[Ct];if(Pt[gt.id]===void 0)continue;const Tt=Pt[gt.id];for(const Rt in Tt)tt(Tt[Rt].object),delete Tt[Rt];delete Pt[gt.id]}}function yt(){vt(),g=!0,d!==c&&(d=c,$(d.object))}function vt(){c.geometry=null,c.program=null,c.wireframe=!1}return{setup:_,reset:yt,resetDefaultState:vt,dispose:ht,releaseStatesOfGeometry:ft,releaseStatesOfProgram:pt,initAttributes:at,enableAttribute:lt,disableUnusedAttributes:it}}function WebGLBufferRenderer(s,e,a){let o;function c(b){o=b}function d(b,$){s.drawArrays(o,b,$),a.update($,o,1)}function g(b,$,tt){tt!==0&&(s.drawArraysInstanced(o,b,$,tt),a.update($,o,tt))}function _(b,$,tt){if(tt===0)return;const rt=e.get("WEBGL_multi_draw");if(rt===null)for(let et=0;et<tt;et++)this.render(b[et],$[et]);else{rt.multiDrawArraysWEBGL(o,b,0,$,0,tt);let et=0;for(let st=0;st<tt;st++)et+=$[st];a.update(et,o,1)}}this.setMode=c,this.render=d,this.renderInstances=g,this.renderMultiDraw=_}function WebGLCapabilities(s,e,a){let o;function c(){if(o!==void 0)return o;if(e.has("EXT_texture_filter_anisotropic")===!0){const nt=e.get("EXT_texture_filter_anisotropic");o=s.getParameter(nt.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else o=0;return o}function d(nt){if(nt==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";nt="mediump"}return nt==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let g=a.precision!==void 0?a.precision:"highp";const _=d(g);_!==g&&(console.warn("THREE.WebGLRenderer:",g,"not supported, using",_,"instead."),g=_);const b=a.logarithmicDepthBuffer===!0,$=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),tt=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),rt=s.getParameter(s.MAX_TEXTURE_SIZE),et=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),st=s.getParameter(s.MAX_VERTEX_ATTRIBS),ot=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),at=s.getParameter(s.MAX_VARYING_VECTORS),lt=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),_e=tt>0,it=s.getParameter(s.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:c,getMaxPrecision:d,precision:g,logarithmicDepthBuffer:b,maxTextures:$,maxVertexTextures:tt,maxTextureSize:rt,maxCubemapSize:et,maxAttributes:st,maxVertexUniforms:ot,maxVaryings:at,maxFragmentUniforms:lt,vertexTextures:_e,maxSamples:it}}function WebGLClipping(s){const e=this;let a=null,o=0,c=!1,d=!1;const g=new Plane,_=new Matrix3,b={value:null,needsUpdate:!1};this.uniform=b,this.numPlanes=0,this.numIntersection=0,this.init=function(rt,et){const st=rt.length!==0||et||o!==0||c;return c=et,o=rt.length,st},this.beginShadows=function(){d=!0,tt(null)},this.endShadows=function(){d=!1},this.setGlobalState=function(rt,et){a=tt(rt,et,0)},this.setState=function(rt,et,st){const ot=rt.clippingPlanes,at=rt.clipIntersection,lt=rt.clipShadows,_e=s.get(rt);if(!c||ot===null||ot.length===0||d&&!lt)d?tt(null):$();else{const it=d?0:o,nt=it*4;let ct=_e.clippingState||null;b.value=ct,ct=tt(ot,et,nt,st);for(let ht=0;ht!==nt;++ht)ct[ht]=a[ht];_e.clippingState=ct,this.numIntersection=at?this.numPlanes:0,this.numPlanes+=it}};function $(){b.value!==a&&(b.value=a,b.needsUpdate=o>0),e.numPlanes=o,e.numIntersection=0}function tt(rt,et,st,ot){const at=rt!==null?rt.length:0;let lt=null;if(at!==0){if(lt=b.value,ot!==!0||lt===null){const _e=st+at*4,it=et.matrixWorldInverse;_.getNormalMatrix(it),(lt===null||lt.length<_e)&&(lt=new Float32Array(_e));for(let nt=0,ct=st;nt!==at;++nt,ct+=4)g.copy(rt[nt]).applyMatrix4(it,_),g.normal.toArray(lt,ct),lt[ct+3]=g.constant}b.value=lt,b.needsUpdate=!0}return e.numPlanes=at,e.numIntersection=0,lt}}function WebGLCubeMaps(s){let e=new WeakMap;function a(g,_){return _===EquirectangularReflectionMapping?g.mapping=CubeReflectionMapping:_===EquirectangularRefractionMapping&&(g.mapping=CubeRefractionMapping),g}function o(g){if(g&&g.isTexture){const _=g.mapping;if(_===EquirectangularReflectionMapping||_===EquirectangularRefractionMapping)if(e.has(g)){const b=e.get(g).texture;return a(b,g.mapping)}else{const b=g.image;if(b&&b.height>0){const $=new WebGLCubeRenderTarget(b.height);return $.fromEquirectangularTexture(s,g),e.set(g,$),g.addEventListener("dispose",c),a($.texture,g.mapping)}else return null}}return g}function c(g){const _=g.target;_.removeEventListener("dispose",c);const b=e.get(_);b!==void 0&&(e.delete(_),b.dispose())}function d(){e=new WeakMap}return{get:o,dispose:d}}class OrthographicCamera extends Camera{constructor(e=-1,a=1,o=1,c=-1,d=.1,g=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=a,this.top=o,this.bottom=c,this.near=d,this.far=g,this.updateProjectionMatrix()}copy(e,a){return super.copy(e,a),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,a,o,c,d,g){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=a,this.view.offsetX=o,this.view.offsetY=c,this.view.width=d,this.view.height=g,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),a=(this.top-this.bottom)/(2*this.zoom),o=(this.right+this.left)/2,c=(this.top+this.bottom)/2;let d=o-e,g=o+e,_=c+a,b=c-a;if(this.view!==null&&this.view.enabled){const $=(this.right-this.left)/this.view.fullWidth/this.zoom,tt=(this.top-this.bottom)/this.view.fullHeight/this.zoom;d+=$*this.view.offsetX,g=d+$*this.view.width,_-=tt*this.view.offsetY,b=_-tt*this.view.height}this.projectionMatrix.makeOrthographic(d,g,_,b,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const a=super.toJSON(e);return a.object.zoom=this.zoom,a.object.left=this.left,a.object.right=this.right,a.object.top=this.top,a.object.bottom=this.bottom,a.object.near=this.near,a.object.far=this.far,this.view!==null&&(a.object.view=Object.assign({},this.view)),a}}const LOD_MIN=4,EXTRA_LOD_SIGMA=[.125,.215,.35,.446,.526,.582],MAX_SAMPLES=20,_flatCamera=new OrthographicCamera,_clearColor=new Color;let _oldTarget=null,_oldActiveCubeFace=0,_oldActiveMipmapLevel=0,_oldXrEnabled=!1;const PHI=(1+Math.sqrt(5))/2,INV_PHI=1/PHI,_axisDirections=[new Vector3(1,1,1),new Vector3(-1,1,1),new Vector3(1,1,-1),new Vector3(-1,1,-1),new Vector3(0,PHI,INV_PHI),new Vector3(0,PHI,-INV_PHI),new Vector3(INV_PHI,0,PHI),new Vector3(-INV_PHI,0,PHI),new Vector3(PHI,INV_PHI,0),new Vector3(-PHI,INV_PHI,0)];class PMREMGenerator{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,a=0,o=.1,c=100){_oldTarget=this._renderer.getRenderTarget(),_oldActiveCubeFace=this._renderer.getActiveCubeFace(),_oldActiveMipmapLevel=this._renderer.getActiveMipmapLevel(),_oldXrEnabled=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const d=this._allocateTargets();return d.depthBuffer=!0,this._sceneToCubeUV(e,o,c,d),a>0&&this._blur(d,0,0,a),this._applyPMREM(d),this._cleanup(d),d}fromEquirectangular(e,a=null){return this._fromTexture(e,a)}fromCubemap(e,a=null){return this._fromTexture(e,a)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=_getCubemapMaterial(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=_getEquirectMaterial(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(_oldTarget,_oldActiveCubeFace,_oldActiveMipmapLevel),this._renderer.xr.enabled=_oldXrEnabled,e.scissorTest=!1,_setViewport(e,0,0,e.width,e.height)}_fromTexture(e,a){e.mapping===CubeReflectionMapping||e.mapping===CubeRefractionMapping?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),_oldTarget=this._renderer.getRenderTarget(),_oldActiveCubeFace=this._renderer.getActiveCubeFace(),_oldActiveMipmapLevel=this._renderer.getActiveMipmapLevel(),_oldXrEnabled=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const o=a||this._allocateTargets();return this._textureToCubeUV(e,o),this._applyPMREM(o),this._cleanup(o),o}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),a=4*this._cubeSize,o={magFilter:LinearFilter,minFilter:LinearFilter,generateMipmaps:!1,type:HalfFloatType,format:RGBAFormat,colorSpace:LinearSRGBColorSpace,depthBuffer:!1},c=_createRenderTarget(e,a,o);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==a){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=_createRenderTarget(e,a,o);const{_lodMax:d}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=_createPlanes(d)),this._blurMaterial=_getBlurShader(d,e,a)}return c}_compileMaterial(e){const a=new Mesh(this._lodPlanes[0],e);this._renderer.compile(a,_flatCamera)}_sceneToCubeUV(e,a,o,c){const _=new PerspectiveCamera(90,1,a,o),b=[1,-1,1,1,1,1],$=[1,1,1,-1,-1,-1],tt=this._renderer,rt=tt.autoClear,et=tt.toneMapping;tt.getClearColor(_clearColor),tt.toneMapping=NoToneMapping,tt.autoClear=!1;const st=new MeshBasicMaterial({name:"PMREM.Background",side:BackSide,depthWrite:!1,depthTest:!1}),ot=new Mesh(new BoxGeometry,st);let at=!1;const lt=e.background;lt?lt.isColor&&(st.color.copy(lt),e.background=null,at=!0):(st.color.copy(_clearColor),at=!0);for(let _e=0;_e<6;_e++){const it=_e%3;it===0?(_.up.set(0,b[_e],0),_.lookAt($[_e],0,0)):it===1?(_.up.set(0,0,b[_e]),_.lookAt(0,$[_e],0)):(_.up.set(0,b[_e],0),_.lookAt(0,0,$[_e]));const nt=this._cubeSize;_setViewport(c,it*nt,_e>2?nt:0,nt,nt),tt.setRenderTarget(c),at&&tt.render(ot,_),tt.render(e,_)}ot.geometry.dispose(),ot.material.dispose(),tt.toneMapping=et,tt.autoClear=rt,e.background=lt}_textureToCubeUV(e,a){const o=this._renderer,c=e.mapping===CubeReflectionMapping||e.mapping===CubeRefractionMapping;c?(this._cubemapMaterial===null&&(this._cubemapMaterial=_getCubemapMaterial()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=_getEquirectMaterial());const d=c?this._cubemapMaterial:this._equirectMaterial,g=new Mesh(this._lodPlanes[0],d),_=d.uniforms;_.envMap.value=e;const b=this._cubeSize;_setViewport(a,0,0,3*b,2*b),o.setRenderTarget(a),o.render(g,_flatCamera)}_applyPMREM(e){const a=this._renderer,o=a.autoClear;a.autoClear=!1;for(let c=1;c<this._lodPlanes.length;c++){const d=Math.sqrt(this._sigmas[c]*this._sigmas[c]-this._sigmas[c-1]*this._sigmas[c-1]),g=_axisDirections[(c-1)%_axisDirections.length];this._blur(e,c-1,c,d,g)}a.autoClear=o}_blur(e,a,o,c,d){const g=this._pingPongRenderTarget;this._halfBlur(e,g,a,o,c,"latitudinal",d),this._halfBlur(g,e,o,o,c,"longitudinal",d)}_halfBlur(e,a,o,c,d,g,_){const b=this._renderer,$=this._blurMaterial;g!=="latitudinal"&&g!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const tt=3,rt=new Mesh(this._lodPlanes[c],$),et=$.uniforms,st=this._sizeLods[o]-1,ot=isFinite(d)?Math.PI/(2*st):2*Math.PI/(2*MAX_SAMPLES-1),at=d/ot,lt=isFinite(d)?1+Math.floor(tt*at):MAX_SAMPLES;lt>MAX_SAMPLES&&console.warn(`sigmaRadians, ${d}, is too large and will clip, as it requested ${lt} samples when the maximum is set to ${MAX_SAMPLES}`);const _e=[];let it=0;for(let pt=0;pt<MAX_SAMPLES;++pt){const yt=pt/at,vt=Math.exp(-yt*yt/2);_e.push(vt),pt===0?it+=vt:pt<lt&&(it+=2*vt)}for(let pt=0;pt<_e.length;pt++)_e[pt]=_e[pt]/it;et.envMap.value=e.texture,et.samples.value=lt,et.weights.value=_e,et.latitudinal.value=g==="latitudinal",_&&(et.poleAxis.value=_);const{_lodMax:nt}=this;et.dTheta.value=ot,et.mipInt.value=nt-o;const ct=this._sizeLods[c],ht=3*ct*(c>nt-LOD_MIN?c-nt+LOD_MIN:0),ft=4*(this._cubeSize-ct);_setViewport(a,ht,ft,3*ct,2*ct),b.setRenderTarget(a),b.render(rt,_flatCamera)}}function _createPlanes(s){const e=[],a=[],o=[];let c=s;const d=s-LOD_MIN+1+EXTRA_LOD_SIGMA.length;for(let g=0;g<d;g++){const _=Math.pow(2,c);a.push(_);let b=1/_;g>s-LOD_MIN?b=EXTRA_LOD_SIGMA[g-s+LOD_MIN-1]:g===0&&(b=0),o.push(b);const $=1/(_-2),tt=-$,rt=1+$,et=[tt,tt,rt,tt,rt,rt,tt,tt,rt,rt,tt,rt],st=6,ot=6,at=3,lt=2,_e=1,it=new Float32Array(at*ot*st),nt=new Float32Array(lt*ot*st),ct=new Float32Array(_e*ot*st);for(let ft=0;ft<st;ft++){const pt=ft%3*2/3-1,yt=ft>2?0:-1,vt=[pt,yt,0,pt+2/3,yt,0,pt+2/3,yt+1,0,pt,yt,0,pt+2/3,yt+1,0,pt,yt+1,0];it.set(vt,at*ot*ft),nt.set(et,lt*ot*ft);const gt=[ft,ft,ft,ft,ft,ft];ct.set(gt,_e*ot*ft)}const ht=new BufferGeometry;ht.setAttribute("position",new BufferAttribute(it,at)),ht.setAttribute("uv",new BufferAttribute(nt,lt)),ht.setAttribute("faceIndex",new BufferAttribute(ct,_e)),e.push(ht),c>LOD_MIN&&c--}return{lodPlanes:e,sizeLods:a,sigmas:o}}function _createRenderTarget(s,e,a){const o=new WebGLRenderTarget(s,e,a);return o.texture.mapping=CubeUVReflectionMapping,o.texture.name="PMREM.cubeUv",o.scissorTest=!0,o}function _setViewport(s,e,a,o,c){s.viewport.set(e,a,o,c),s.scissor.set(e,a,o,c)}function _getBlurShader(s,e,a){const o=new Float32Array(MAX_SAMPLES),c=new Vector3(0,1,0);return new ShaderMaterial({name:"SphericalGaussianBlur",defines:{n:MAX_SAMPLES,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/a,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:o},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:c}},vertexShader:_getCommonVertexShader(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:NoBlending,depthTest:!1,depthWrite:!1})}function _getEquirectMaterial(){return new ShaderMaterial({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:_getCommonVertexShader(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:NoBlending,depthTest:!1,depthWrite:!1})}function _getCubemapMaterial(){return new ShaderMaterial({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:_getCommonVertexShader(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:NoBlending,depthTest:!1,depthWrite:!1})}function _getCommonVertexShader(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function WebGLCubeUVMaps(s){let e=new WeakMap,a=null;function o(_){if(_&&_.isTexture){const b=_.mapping,$=b===EquirectangularReflectionMapping||b===EquirectangularRefractionMapping,tt=b===CubeReflectionMapping||b===CubeRefractionMapping;if($||tt){let rt=e.get(_);const et=rt!==void 0?rt.texture.pmremVersion:0;if(_.isRenderTargetTexture&&_.pmremVersion!==et)return a===null&&(a=new PMREMGenerator(s)),rt=$?a.fromEquirectangular(_,rt):a.fromCubemap(_,rt),rt.texture.pmremVersion=_.pmremVersion,e.set(_,rt),rt.texture;if(rt!==void 0)return rt.texture;{const st=_.image;return $&&st&&st.height>0||tt&&st&&c(st)?(a===null&&(a=new PMREMGenerator(s)),rt=$?a.fromEquirectangular(_):a.fromCubemap(_),rt.texture.pmremVersion=_.pmremVersion,e.set(_,rt),_.addEventListener("dispose",d),rt.texture):null}}}return _}function c(_){let b=0;const $=6;for(let tt=0;tt<$;tt++)_[tt]!==void 0&&b++;return b===$}function d(_){const b=_.target;b.removeEventListener("dispose",d);const $=e.get(b);$!==void 0&&(e.delete(b),$.dispose())}function g(){e=new WeakMap,a!==null&&(a.dispose(),a=null)}return{get:o,dispose:g}}function WebGLExtensions(s){const e={};function a(o){if(e[o]!==void 0)return e[o];let c;switch(o){case"WEBGL_depth_texture":c=s.getExtension("WEBGL_depth_texture")||s.getExtension("MOZ_WEBGL_depth_texture")||s.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":c=s.getExtension("EXT_texture_filter_anisotropic")||s.getExtension("MOZ_EXT_texture_filter_anisotropic")||s.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":c=s.getExtension("WEBGL_compressed_texture_s3tc")||s.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":c=s.getExtension("WEBGL_compressed_texture_pvrtc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:c=s.getExtension(o)}return e[o]=c,c}return{has:function(o){return a(o)!==null},init:function(){a("EXT_color_buffer_float"),a("WEBGL_clip_cull_distance"),a("OES_texture_float_linear"),a("EXT_color_buffer_half_float"),a("WEBGL_multisampled_render_to_texture"),a("WEBGL_render_shared_exponent")},get:function(o){const c=a(o);return c===null&&console.warn("THREE.WebGLRenderer: "+o+" extension not supported."),c}}}function WebGLGeometries(s,e,a,o){const c={},d=new WeakMap;function g(rt){const et=rt.target;et.index!==null&&e.remove(et.index);for(const ot in et.attributes)e.remove(et.attributes[ot]);for(const ot in et.morphAttributes){const at=et.morphAttributes[ot];for(let lt=0,_e=at.length;lt<_e;lt++)e.remove(at[lt])}et.removeEventListener("dispose",g),delete c[et.id];const st=d.get(et);st&&(e.remove(st),d.delete(et)),o.releaseStatesOfGeometry(et),et.isInstancedBufferGeometry===!0&&delete et._maxInstanceCount,a.memory.geometries--}function _(rt,et){return c[et.id]===!0||(et.addEventListener("dispose",g),c[et.id]=!0,a.memory.geometries++),et}function b(rt){const et=rt.attributes;for(const ot in et)e.update(et[ot],s.ARRAY_BUFFER);const st=rt.morphAttributes;for(const ot in st){const at=st[ot];for(let lt=0,_e=at.length;lt<_e;lt++)e.update(at[lt],s.ARRAY_BUFFER)}}function $(rt){const et=[],st=rt.index,ot=rt.attributes.position;let at=0;if(st!==null){const it=st.array;at=st.version;for(let nt=0,ct=it.length;nt<ct;nt+=3){const ht=it[nt+0],ft=it[nt+1],pt=it[nt+2];et.push(ht,ft,ft,pt,pt,ht)}}else if(ot!==void 0){const it=ot.array;at=ot.version;for(let nt=0,ct=it.length/3-1;nt<ct;nt+=3){const ht=nt+0,ft=nt+1,pt=nt+2;et.push(ht,ft,ft,pt,pt,ht)}}else return;const lt=new(arrayNeedsUint32(et)?Uint32BufferAttribute:Uint16BufferAttribute)(et,1);lt.version=at;const _e=d.get(rt);_e&&e.remove(_e),d.set(rt,lt)}function tt(rt){const et=d.get(rt);if(et){const st=rt.index;st!==null&&et.version<st.version&&$(rt)}else $(rt);return d.get(rt)}return{get:_,update:b,getWireframeAttribute:tt}}function WebGLIndexedBufferRenderer(s,e,a){let o;function c(rt){o=rt}let d,g;function _(rt){d=rt.type,g=rt.bytesPerElement}function b(rt,et){s.drawElements(o,et,d,rt*g),a.update(et,o,1)}function $(rt,et,st){st!==0&&(s.drawElementsInstanced(o,et,d,rt*g,st),a.update(et,o,st))}function tt(rt,et,st){if(st===0)return;const ot=e.get("WEBGL_multi_draw");if(ot===null)for(let at=0;at<st;at++)this.render(rt[at]/g,et[at]);else{ot.multiDrawElementsWEBGL(o,et,0,d,rt,0,st);let at=0;for(let lt=0;lt<st;lt++)at+=et[lt];a.update(at,o,1)}}this.setMode=c,this.setIndex=_,this.render=b,this.renderInstances=$,this.renderMultiDraw=tt}function WebGLInfo(s){const e={geometries:0,textures:0},a={frame:0,calls:0,triangles:0,points:0,lines:0};function o(d,g,_){switch(a.calls++,g){case s.TRIANGLES:a.triangles+=_*(d/3);break;case s.LINES:a.lines+=_*(d/2);break;case s.LINE_STRIP:a.lines+=_*(d-1);break;case s.LINE_LOOP:a.lines+=_*d;break;case s.POINTS:a.points+=_*d;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",g);break}}function c(){a.calls=0,a.triangles=0,a.points=0,a.lines=0}return{memory:e,render:a,programs:null,autoReset:!0,reset:c,update:o}}function WebGLMorphtargets(s,e,a){const o=new WeakMap,c=new Vector4;function d(g,_,b){const $=g.morphTargetInfluences,tt=_.morphAttributes.position||_.morphAttributes.normal||_.morphAttributes.color,rt=tt!==void 0?tt.length:0;let et=o.get(_);if(et===void 0||et.count!==rt){let gt=function(){yt.dispose(),o.delete(_),_.removeEventListener("dispose",gt)};var st=gt;et!==void 0&&et.texture.dispose();const ot=_.morphAttributes.position!==void 0,at=_.morphAttributes.normal!==void 0,lt=_.morphAttributes.color!==void 0,_e=_.morphAttributes.position||[],it=_.morphAttributes.normal||[],nt=_.morphAttributes.color||[];let ct=0;ot===!0&&(ct=1),at===!0&&(ct=2),lt===!0&&(ct=3);let ht=_.attributes.position.count*ct,ft=1;ht>e.maxTextureSize&&(ft=Math.ceil(ht/e.maxTextureSize),ht=e.maxTextureSize);const pt=new Float32Array(ht*ft*4*rt),yt=new DataArrayTexture(pt,ht,ft,rt);yt.type=FloatType,yt.needsUpdate=!0;const vt=ct*4;for(let Ct=0;Ct<rt;Ct++){const Pt=_e[Ct],Tt=it[Ct],Rt=nt[Ct],wt=ht*ft*4*Ct;for(let _t=0;_t<Pt.count;_t++){const St=_t*vt;ot===!0&&(c.fromBufferAttribute(Pt,_t),pt[wt+St+0]=c.x,pt[wt+St+1]=c.y,pt[wt+St+2]=c.z,pt[wt+St+3]=0),at===!0&&(c.fromBufferAttribute(Tt,_t),pt[wt+St+4]=c.x,pt[wt+St+5]=c.y,pt[wt+St+6]=c.z,pt[wt+St+7]=0),lt===!0&&(c.fromBufferAttribute(Rt,_t),pt[wt+St+8]=c.x,pt[wt+St+9]=c.y,pt[wt+St+10]=c.z,pt[wt+St+11]=Rt.itemSize===4?c.w:1)}}et={count:rt,texture:yt,size:new Vector2(ht,ft)},o.set(_,et),_.addEventListener("dispose",gt)}if(g.isInstancedMesh===!0&&g.morphTexture!==null)b.getUniforms().setValue(s,"morphTexture",g.morphTexture,a);else{let ot=0;for(let lt=0;lt<$.length;lt++)ot+=$[lt];const at=_.morphTargetsRelative?1:1-ot;b.getUniforms().setValue(s,"morphTargetBaseInfluence",at),b.getUniforms().setValue(s,"morphTargetInfluences",$)}b.getUniforms().setValue(s,"morphTargetsTexture",et.texture,a),b.getUniforms().setValue(s,"morphTargetsTextureSize",et.size)}return{update:d}}function WebGLObjects(s,e,a,o){let c=new WeakMap;function d(b){const $=o.render.frame,tt=b.geometry,rt=e.get(b,tt);if(c.get(rt)!==$&&(e.update(rt),c.set(rt,$)),b.isInstancedMesh&&(b.hasEventListener("dispose",_)===!1&&b.addEventListener("dispose",_),c.get(b)!==$&&(a.update(b.instanceMatrix,s.ARRAY_BUFFER),b.instanceColor!==null&&a.update(b.instanceColor,s.ARRAY_BUFFER),c.set(b,$))),b.isSkinnedMesh){const et=b.skeleton;c.get(et)!==$&&(et.update(),c.set(et,$))}return rt}function g(){c=new WeakMap}function _(b){const $=b.target;$.removeEventListener("dispose",_),a.remove($.instanceMatrix),$.instanceColor!==null&&a.remove($.instanceColor)}return{update:d,dispose:g}}class DepthTexture extends Texture{constructor(e,a,o,c,d,g,_,b,$,tt){if(tt=tt!==void 0?tt:DepthFormat,tt!==DepthFormat&&tt!==DepthStencilFormat)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");o===void 0&&tt===DepthFormat&&(o=UnsignedIntType),o===void 0&&tt===DepthStencilFormat&&(o=UnsignedInt248Type),super(null,c,d,g,_,b,tt,o,$),this.isDepthTexture=!0,this.image={width:e,height:a},this.magFilter=_!==void 0?_:NearestFilter,this.minFilter=b!==void 0?b:NearestFilter,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const a=super.toJSON(e);return this.compareFunction!==null&&(a.compareFunction=this.compareFunction),a}}const emptyTexture=new Texture,emptyShadowTexture=new DepthTexture(1,1);emptyShadowTexture.compareFunction=LessEqualCompare;const emptyArrayTexture=new DataArrayTexture,empty3dTexture=new Data3DTexture,emptyCubeTexture=new CubeTexture,arrayCacheF32=[],arrayCacheI32=[],mat4array=new Float32Array(16),mat3array=new Float32Array(9),mat2array=new Float32Array(4);function flatten(s,e,a){const o=s[0];if(o<=0||o>0)return s;const c=e*a;let d=arrayCacheF32[c];if(d===void 0&&(d=new Float32Array(c),arrayCacheF32[c]=d),e!==0){o.toArray(d,0);for(let g=1,_=0;g!==e;++g)_+=a,s[g].toArray(d,_)}return d}function arraysEqual(s,e){if(s.length!==e.length)return!1;for(let a=0,o=s.length;a<o;a++)if(s[a]!==e[a])return!1;return!0}function copyArray(s,e){for(let a=0,o=e.length;a<o;a++)s[a]=e[a]}function allocTexUnits(s,e){let a=arrayCacheI32[e];a===void 0&&(a=new Int32Array(e),arrayCacheI32[e]=a);for(let o=0;o!==e;++o)a[o]=s.allocateTextureUnit();return a}function setValueV1f(s,e){const a=this.cache;a[0]!==e&&(s.uniform1f(this.addr,e),a[0]=e)}function setValueV2f(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y)&&(s.uniform2f(this.addr,e.x,e.y),a[0]=e.x,a[1]=e.y);else{if(arraysEqual(a,e))return;s.uniform2fv(this.addr,e),copyArray(a,e)}}function setValueV3f(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y||a[2]!==e.z)&&(s.uniform3f(this.addr,e.x,e.y,e.z),a[0]=e.x,a[1]=e.y,a[2]=e.z);else if(e.r!==void 0)(a[0]!==e.r||a[1]!==e.g||a[2]!==e.b)&&(s.uniform3f(this.addr,e.r,e.g,e.b),a[0]=e.r,a[1]=e.g,a[2]=e.b);else{if(arraysEqual(a,e))return;s.uniform3fv(this.addr,e),copyArray(a,e)}}function setValueV4f(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y||a[2]!==e.z||a[3]!==e.w)&&(s.uniform4f(this.addr,e.x,e.y,e.z,e.w),a[0]=e.x,a[1]=e.y,a[2]=e.z,a[3]=e.w);else{if(arraysEqual(a,e))return;s.uniform4fv(this.addr,e),copyArray(a,e)}}function setValueM2(s,e){const a=this.cache,o=e.elements;if(o===void 0){if(arraysEqual(a,e))return;s.uniformMatrix2fv(this.addr,!1,e),copyArray(a,e)}else{if(arraysEqual(a,o))return;mat2array.set(o),s.uniformMatrix2fv(this.addr,!1,mat2array),copyArray(a,o)}}function setValueM3(s,e){const a=this.cache,o=e.elements;if(o===void 0){if(arraysEqual(a,e))return;s.uniformMatrix3fv(this.addr,!1,e),copyArray(a,e)}else{if(arraysEqual(a,o))return;mat3array.set(o),s.uniformMatrix3fv(this.addr,!1,mat3array),copyArray(a,o)}}function setValueM4(s,e){const a=this.cache,o=e.elements;if(o===void 0){if(arraysEqual(a,e))return;s.uniformMatrix4fv(this.addr,!1,e),copyArray(a,e)}else{if(arraysEqual(a,o))return;mat4array.set(o),s.uniformMatrix4fv(this.addr,!1,mat4array),copyArray(a,o)}}function setValueV1i(s,e){const a=this.cache;a[0]!==e&&(s.uniform1i(this.addr,e),a[0]=e)}function setValueV2i(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y)&&(s.uniform2i(this.addr,e.x,e.y),a[0]=e.x,a[1]=e.y);else{if(arraysEqual(a,e))return;s.uniform2iv(this.addr,e),copyArray(a,e)}}function setValueV3i(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y||a[2]!==e.z)&&(s.uniform3i(this.addr,e.x,e.y,e.z),a[0]=e.x,a[1]=e.y,a[2]=e.z);else{if(arraysEqual(a,e))return;s.uniform3iv(this.addr,e),copyArray(a,e)}}function setValueV4i(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y||a[2]!==e.z||a[3]!==e.w)&&(s.uniform4i(this.addr,e.x,e.y,e.z,e.w),a[0]=e.x,a[1]=e.y,a[2]=e.z,a[3]=e.w);else{if(arraysEqual(a,e))return;s.uniform4iv(this.addr,e),copyArray(a,e)}}function setValueV1ui(s,e){const a=this.cache;a[0]!==e&&(s.uniform1ui(this.addr,e),a[0]=e)}function setValueV2ui(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y)&&(s.uniform2ui(this.addr,e.x,e.y),a[0]=e.x,a[1]=e.y);else{if(arraysEqual(a,e))return;s.uniform2uiv(this.addr,e),copyArray(a,e)}}function setValueV3ui(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y||a[2]!==e.z)&&(s.uniform3ui(this.addr,e.x,e.y,e.z),a[0]=e.x,a[1]=e.y,a[2]=e.z);else{if(arraysEqual(a,e))return;s.uniform3uiv(this.addr,e),copyArray(a,e)}}function setValueV4ui(s,e){const a=this.cache;if(e.x!==void 0)(a[0]!==e.x||a[1]!==e.y||a[2]!==e.z||a[3]!==e.w)&&(s.uniform4ui(this.addr,e.x,e.y,e.z,e.w),a[0]=e.x,a[1]=e.y,a[2]=e.z,a[3]=e.w);else{if(arraysEqual(a,e))return;s.uniform4uiv(this.addr,e),copyArray(a,e)}}function setValueT1(s,e,a){const o=this.cache,c=a.allocateTextureUnit();o[0]!==c&&(s.uniform1i(this.addr,c),o[0]=c);const d=this.type===s.SAMPLER_2D_SHADOW?emptyShadowTexture:emptyTexture;a.setTexture2D(e||d,c)}function setValueT3D1(s,e,a){const o=this.cache,c=a.allocateTextureUnit();o[0]!==c&&(s.uniform1i(this.addr,c),o[0]=c),a.setTexture3D(e||empty3dTexture,c)}function setValueT6(s,e,a){const o=this.cache,c=a.allocateTextureUnit();o[0]!==c&&(s.uniform1i(this.addr,c),o[0]=c),a.setTextureCube(e||emptyCubeTexture,c)}function setValueT2DArray1(s,e,a){const o=this.cache,c=a.allocateTextureUnit();o[0]!==c&&(s.uniform1i(this.addr,c),o[0]=c),a.setTexture2DArray(e||emptyArrayTexture,c)}function getSingularSetter(s){switch(s){case 5126:return setValueV1f;case 35664:return setValueV2f;case 35665:return setValueV3f;case 35666:return setValueV4f;case 35674:return setValueM2;case 35675:return setValueM3;case 35676:return setValueM4;case 5124:case 35670:return setValueV1i;case 35667:case 35671:return setValueV2i;case 35668:case 35672:return setValueV3i;case 35669:case 35673:return setValueV4i;case 5125:return setValueV1ui;case 36294:return setValueV2ui;case 36295:return setValueV3ui;case 36296:return setValueV4ui;case 35678:case 36198:case 36298:case 36306:case 35682:return setValueT1;case 35679:case 36299:case 36307:return setValueT3D1;case 35680:case 36300:case 36308:case 36293:return setValueT6;case 36289:case 36303:case 36311:case 36292:return setValueT2DArray1}}function setValueV1fArray(s,e){s.uniform1fv(this.addr,e)}function setValueV2fArray(s,e){const a=flatten(e,this.size,2);s.uniform2fv(this.addr,a)}function setValueV3fArray(s,e){const a=flatten(e,this.size,3);s.uniform3fv(this.addr,a)}function setValueV4fArray(s,e){const a=flatten(e,this.size,4);s.uniform4fv(this.addr,a)}function setValueM2Array(s,e){const a=flatten(e,this.size,4);s.uniformMatrix2fv(this.addr,!1,a)}function setValueM3Array(s,e){const a=flatten(e,this.size,9);s.uniformMatrix3fv(this.addr,!1,a)}function setValueM4Array(s,e){const a=flatten(e,this.size,16);s.uniformMatrix4fv(this.addr,!1,a)}function setValueV1iArray(s,e){s.uniform1iv(this.addr,e)}function setValueV2iArray(s,e){s.uniform2iv(this.addr,e)}function setValueV3iArray(s,e){s.uniform3iv(this.addr,e)}function setValueV4iArray(s,e){s.uniform4iv(this.addr,e)}function setValueV1uiArray(s,e){s.uniform1uiv(this.addr,e)}function setValueV2uiArray(s,e){s.uniform2uiv(this.addr,e)}function setValueV3uiArray(s,e){s.uniform3uiv(this.addr,e)}function setValueV4uiArray(s,e){s.uniform4uiv(this.addr,e)}function setValueT1Array(s,e,a){const o=this.cache,c=e.length,d=allocTexUnits(a,c);arraysEqual(o,d)||(s.uniform1iv(this.addr,d),copyArray(o,d));for(let g=0;g!==c;++g)a.setTexture2D(e[g]||emptyTexture,d[g])}function setValueT3DArray(s,e,a){const o=this.cache,c=e.length,d=allocTexUnits(a,c);arraysEqual(o,d)||(s.uniform1iv(this.addr,d),copyArray(o,d));for(let g=0;g!==c;++g)a.setTexture3D(e[g]||empty3dTexture,d[g])}function setValueT6Array(s,e,a){const o=this.cache,c=e.length,d=allocTexUnits(a,c);arraysEqual(o,d)||(s.uniform1iv(this.addr,d),copyArray(o,d));for(let g=0;g!==c;++g)a.setTextureCube(e[g]||emptyCubeTexture,d[g])}function setValueT2DArrayArray(s,e,a){const o=this.cache,c=e.length,d=allocTexUnits(a,c);arraysEqual(o,d)||(s.uniform1iv(this.addr,d),copyArray(o,d));for(let g=0;g!==c;++g)a.setTexture2DArray(e[g]||emptyArrayTexture,d[g])}function getPureArraySetter(s){switch(s){case 5126:return setValueV1fArray;case 35664:return setValueV2fArray;case 35665:return setValueV3fArray;case 35666:return setValueV4fArray;case 35674:return setValueM2Array;case 35675:return setValueM3Array;case 35676:return setValueM4Array;case 5124:case 35670:return setValueV1iArray;case 35667:case 35671:return setValueV2iArray;case 35668:case 35672:return setValueV3iArray;case 35669:case 35673:return setValueV4iArray;case 5125:return setValueV1uiArray;case 36294:return setValueV2uiArray;case 36295:return setValueV3uiArray;case 36296:return setValueV4uiArray;case 35678:case 36198:case 36298:case 36306:case 35682:return setValueT1Array;case 35679:case 36299:case 36307:return setValueT3DArray;case 35680:case 36300:case 36308:case 36293:return setValueT6Array;case 36289:case 36303:case 36311:case 36292:return setValueT2DArrayArray}}class SingleUniform{constructor(e,a,o){this.id=e,this.addr=o,this.cache=[],this.type=a.type,this.setValue=getSingularSetter(a.type)}}class PureArrayUniform{constructor(e,a,o){this.id=e,this.addr=o,this.cache=[],this.type=a.type,this.size=a.size,this.setValue=getPureArraySetter(a.type)}}class StructuredUniform{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,a,o){const c=this.seq;for(let d=0,g=c.length;d!==g;++d){const _=c[d];_.setValue(e,a[_.id],o)}}}const RePathPart=/(\w+)(\])?(\[|\.)?/g;function addUniform(s,e){s.seq.push(e),s.map[e.id]=e}function parseUniform(s,e,a){const o=s.name,c=o.length;for(RePathPart.lastIndex=0;;){const d=RePathPart.exec(o),g=RePathPart.lastIndex;let _=d[1];const b=d[2]==="]",$=d[3];if(b&&(_=_|0),$===void 0||$==="["&&g+2===c){addUniform(a,$===void 0?new SingleUniform(_,s,e):new PureArrayUniform(_,s,e));break}else{let rt=a.map[_];rt===void 0&&(rt=new StructuredUniform(_),addUniform(a,rt)),a=rt}}}class WebGLUniforms{constructor(e,a){this.seq=[],this.map={};const o=e.getProgramParameter(a,e.ACTIVE_UNIFORMS);for(let c=0;c<o;++c){const d=e.getActiveUniform(a,c),g=e.getUniformLocation(a,d.name);parseUniform(d,g,this)}}setValue(e,a,o,c){const d=this.map[a];d!==void 0&&d.setValue(e,o,c)}setOptional(e,a,o){const c=a[o];c!==void 0&&this.setValue(e,o,c)}static upload(e,a,o,c){for(let d=0,g=a.length;d!==g;++d){const _=a[d],b=o[_.id];b.needsUpdate!==!1&&_.setValue(e,b.value,c)}}static seqWithValue(e,a){const o=[];for(let c=0,d=e.length;c!==d;++c){const g=e[c];g.id in a&&o.push(g)}return o}}function WebGLShader(s,e,a){const o=s.createShader(e);return s.shaderSource(o,a),s.compileShader(o),o}const COMPLETION_STATUS_KHR=37297;let programIdCount=0;function handleSource(s,e){const a=s.split(`
`),o=[],c=Math.max(e-6,0),d=Math.min(e+6,a.length);for(let g=c;g<d;g++){const _=g+1;o.push(`${_===e?">":" "} ${_}: ${a[g]}`)}return o.join(`
`)}function getEncodingComponents(s){const e=ColorManagement.getPrimaries(ColorManagement.workingColorSpace),a=ColorManagement.getPrimaries(s);let o;switch(e===a?o="":e===P3Primaries&&a===Rec709Primaries?o="LinearDisplayP3ToLinearSRGB":e===Rec709Primaries&&a===P3Primaries&&(o="LinearSRGBToLinearDisplayP3"),s){case LinearSRGBColorSpace:case LinearDisplayP3ColorSpace:return[o,"LinearTransferOETF"];case SRGBColorSpace:case DisplayP3ColorSpace:return[o,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",s),[o,"LinearTransferOETF"]}}function getShaderErrors(s,e,a){const o=s.getShaderParameter(e,s.COMPILE_STATUS),c=s.getShaderInfoLog(e).trim();if(o&&c==="")return"";const d=/ERROR: 0:(\d+)/.exec(c);if(d){const g=parseInt(d[1]);return a.toUpperCase()+`

`+c+`

`+handleSource(s.getShaderSource(e),g)}else return c}function getTexelEncodingFunction(s,e){const a=getEncodingComponents(e);return`vec4 ${s}( vec4 value ) { return ${a[0]}( ${a[1]}( value ) ); }`}function getToneMappingFunction(s,e){let a;switch(e){case LinearToneMapping:a="Linear";break;case ReinhardToneMapping:a="Reinhard";break;case CineonToneMapping:a="OptimizedCineon";break;case ACESFilmicToneMapping:a="ACESFilmic";break;case AgXToneMapping:a="AgX";break;case NeutralToneMapping:a="Neutral";break;case CustomToneMapping:a="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),a="Linear"}return"vec3 "+s+"( vec3 color ) { return "+a+"ToneMapping( color ); }"}function generateVertexExtensions(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(filterEmptyLine).join(`
`)}function generateDefines(s){const e=[];for(const a in s){const o=s[a];o!==!1&&e.push("#define "+a+" "+o)}return e.join(`
`)}function fetchAttributeLocations(s,e){const a={},o=s.getProgramParameter(e,s.ACTIVE_ATTRIBUTES);for(let c=0;c<o;c++){const d=s.getActiveAttrib(e,c),g=d.name;let _=1;d.type===s.FLOAT_MAT2&&(_=2),d.type===s.FLOAT_MAT3&&(_=3),d.type===s.FLOAT_MAT4&&(_=4),a[g]={type:d.type,location:s.getAttribLocation(e,g),locationSize:_}}return a}function filterEmptyLine(s){return s!==""}function replaceLightNums(s,e){const a=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return s.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,a).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function replaceClippingPlaneNums(s,e){return s.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const includePattern=/^[ \t]*#include +<([\w\d./]+)>/gm;function resolveIncludes(s){return s.replace(includePattern,includeReplacer)}const shaderChunkMap=new Map([["encodings_fragment","colorspace_fragment"],["encodings_pars_fragment","colorspace_pars_fragment"],["output_fragment","opaque_fragment"]]);function includeReplacer(s,e){let a=ShaderChunk[e];if(a===void 0){const o=shaderChunkMap.get(e);if(o!==void 0)a=ShaderChunk[o],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,o);else throw new Error("Can not resolve #include <"+e+">")}return resolveIncludes(a)}const unrollLoopPattern=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function unrollLoops(s){return s.replace(unrollLoopPattern,loopReplacer)}function loopReplacer(s,e,a,o){let c="";for(let d=parseInt(e);d<parseInt(a);d++)c+=o.replace(/\[\s*i\s*\]/g,"[ "+d+" ]").replace(/UNROLLED_LOOP_INDEX/g,d);return c}function generatePrecision(s){let e=`precision ${s.precision} float;
	precision ${s.precision} int;
	precision ${s.precision} sampler2D;
	precision ${s.precision} samplerCube;
	precision ${s.precision} sampler3D;
	precision ${s.precision} sampler2DArray;
	precision ${s.precision} sampler2DShadow;
	precision ${s.precision} samplerCubeShadow;
	precision ${s.precision} sampler2DArrayShadow;
	precision ${s.precision} isampler2D;
	precision ${s.precision} isampler3D;
	precision ${s.precision} isamplerCube;
	precision ${s.precision} isampler2DArray;
	precision ${s.precision} usampler2D;
	precision ${s.precision} usampler3D;
	precision ${s.precision} usamplerCube;
	precision ${s.precision} usampler2DArray;
	`;return s.precision==="highp"?e+=`
#define HIGH_PRECISION`:s.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:s.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function generateShadowMapTypeDefine(s){let e="SHADOWMAP_TYPE_BASIC";return s.shadowMapType===PCFShadowMap?e="SHADOWMAP_TYPE_PCF":s.shadowMapType===PCFSoftShadowMap?e="SHADOWMAP_TYPE_PCF_SOFT":s.shadowMapType===VSMShadowMap&&(e="SHADOWMAP_TYPE_VSM"),e}function generateEnvMapTypeDefine(s){let e="ENVMAP_TYPE_CUBE";if(s.envMap)switch(s.envMapMode){case CubeReflectionMapping:case CubeRefractionMapping:e="ENVMAP_TYPE_CUBE";break;case CubeUVReflectionMapping:e="ENVMAP_TYPE_CUBE_UV";break}return e}function generateEnvMapModeDefine(s){let e="ENVMAP_MODE_REFLECTION";if(s.envMap)switch(s.envMapMode){case CubeRefractionMapping:e="ENVMAP_MODE_REFRACTION";break}return e}function generateEnvMapBlendingDefine(s){let e="ENVMAP_BLENDING_NONE";if(s.envMap)switch(s.combine){case MultiplyOperation:e="ENVMAP_BLENDING_MULTIPLY";break;case MixOperation:e="ENVMAP_BLENDING_MIX";break;case AddOperation:e="ENVMAP_BLENDING_ADD";break}return e}function generateCubeUVSize(s){const e=s.envMapCubeUVHeight;if(e===null)return null;const a=Math.log2(e)-2,o=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,a),7*16)),texelHeight:o,maxMip:a}}function WebGLProgram(s,e,a,o){const c=s.getContext(),d=a.defines;let g=a.vertexShader,_=a.fragmentShader;const b=generateShadowMapTypeDefine(a),$=generateEnvMapTypeDefine(a),tt=generateEnvMapModeDefine(a),rt=generateEnvMapBlendingDefine(a),et=generateCubeUVSize(a),st=generateVertexExtensions(a),ot=generateDefines(d),at=c.createProgram();let lt,_e,it=a.glslVersion?"#version "+a.glslVersion+`
`:"";a.isRawShaderMaterial?(lt=["#define SHADER_TYPE "+a.shaderType,"#define SHADER_NAME "+a.shaderName,ot].filter(filterEmptyLine).join(`
`),lt.length>0&&(lt+=`
`),_e=["#define SHADER_TYPE "+a.shaderType,"#define SHADER_NAME "+a.shaderName,ot].filter(filterEmptyLine).join(`
`),_e.length>0&&(_e+=`
`)):(lt=[generatePrecision(a),"#define SHADER_TYPE "+a.shaderType,"#define SHADER_NAME "+a.shaderName,ot,a.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",a.batching?"#define USE_BATCHING":"",a.instancing?"#define USE_INSTANCING":"",a.instancingColor?"#define USE_INSTANCING_COLOR":"",a.instancingMorph?"#define USE_INSTANCING_MORPH":"",a.useFog&&a.fog?"#define USE_FOG":"",a.useFog&&a.fogExp2?"#define FOG_EXP2":"",a.map?"#define USE_MAP":"",a.envMap?"#define USE_ENVMAP":"",a.envMap?"#define "+tt:"",a.lightMap?"#define USE_LIGHTMAP":"",a.aoMap?"#define USE_AOMAP":"",a.bumpMap?"#define USE_BUMPMAP":"",a.normalMap?"#define USE_NORMALMAP":"",a.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",a.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",a.displacementMap?"#define USE_DISPLACEMENTMAP":"",a.emissiveMap?"#define USE_EMISSIVEMAP":"",a.anisotropy?"#define USE_ANISOTROPY":"",a.anisotropyMap?"#define USE_ANISOTROPYMAP":"",a.clearcoatMap?"#define USE_CLEARCOATMAP":"",a.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",a.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",a.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",a.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",a.specularMap?"#define USE_SPECULARMAP":"",a.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",a.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",a.roughnessMap?"#define USE_ROUGHNESSMAP":"",a.metalnessMap?"#define USE_METALNESSMAP":"",a.alphaMap?"#define USE_ALPHAMAP":"",a.alphaHash?"#define USE_ALPHAHASH":"",a.transmission?"#define USE_TRANSMISSION":"",a.transmissionMap?"#define USE_TRANSMISSIONMAP":"",a.thicknessMap?"#define USE_THICKNESSMAP":"",a.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",a.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",a.mapUv?"#define MAP_UV "+a.mapUv:"",a.alphaMapUv?"#define ALPHAMAP_UV "+a.alphaMapUv:"",a.lightMapUv?"#define LIGHTMAP_UV "+a.lightMapUv:"",a.aoMapUv?"#define AOMAP_UV "+a.aoMapUv:"",a.emissiveMapUv?"#define EMISSIVEMAP_UV "+a.emissiveMapUv:"",a.bumpMapUv?"#define BUMPMAP_UV "+a.bumpMapUv:"",a.normalMapUv?"#define NORMALMAP_UV "+a.normalMapUv:"",a.displacementMapUv?"#define DISPLACEMENTMAP_UV "+a.displacementMapUv:"",a.metalnessMapUv?"#define METALNESSMAP_UV "+a.metalnessMapUv:"",a.roughnessMapUv?"#define ROUGHNESSMAP_UV "+a.roughnessMapUv:"",a.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+a.anisotropyMapUv:"",a.clearcoatMapUv?"#define CLEARCOATMAP_UV "+a.clearcoatMapUv:"",a.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+a.clearcoatNormalMapUv:"",a.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+a.clearcoatRoughnessMapUv:"",a.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+a.iridescenceMapUv:"",a.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+a.iridescenceThicknessMapUv:"",a.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+a.sheenColorMapUv:"",a.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+a.sheenRoughnessMapUv:"",a.specularMapUv?"#define SPECULARMAP_UV "+a.specularMapUv:"",a.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+a.specularColorMapUv:"",a.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+a.specularIntensityMapUv:"",a.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+a.transmissionMapUv:"",a.thicknessMapUv?"#define THICKNESSMAP_UV "+a.thicknessMapUv:"",a.vertexTangents&&a.flatShading===!1?"#define USE_TANGENT":"",a.vertexColors?"#define USE_COLOR":"",a.vertexAlphas?"#define USE_COLOR_ALPHA":"",a.vertexUv1s?"#define USE_UV1":"",a.vertexUv2s?"#define USE_UV2":"",a.vertexUv3s?"#define USE_UV3":"",a.pointsUvs?"#define USE_POINTS_UV":"",a.flatShading?"#define FLAT_SHADED":"",a.skinning?"#define USE_SKINNING":"",a.morphTargets?"#define USE_MORPHTARGETS":"",a.morphNormals&&a.flatShading===!1?"#define USE_MORPHNORMALS":"",a.morphColors?"#define USE_MORPHCOLORS":"",a.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE":"",a.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+a.morphTextureStride:"",a.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+a.morphTargetsCount:"",a.doubleSided?"#define DOUBLE_SIDED":"",a.flipSided?"#define FLIP_SIDED":"",a.shadowMapEnabled?"#define USE_SHADOWMAP":"",a.shadowMapEnabled?"#define "+b:"",a.sizeAttenuation?"#define USE_SIZEATTENUATION":"",a.numLightProbes>0?"#define USE_LIGHT_PROBES":"",a.useLegacyLights?"#define LEGACY_LIGHTS":"",a.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#if ( defined( USE_MORPHTARGETS ) && ! defined( MORPHTARGETS_TEXTURE ) )","	attribute vec3 morphTarget0;","	attribute vec3 morphTarget1;","	attribute vec3 morphTarget2;","	attribute vec3 morphTarget3;","	#ifdef USE_MORPHNORMALS","		attribute vec3 morphNormal0;","		attribute vec3 morphNormal1;","		attribute vec3 morphNormal2;","		attribute vec3 morphNormal3;","	#else","		attribute vec3 morphTarget4;","		attribute vec3 morphTarget5;","		attribute vec3 morphTarget6;","		attribute vec3 morphTarget7;","	#endif","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(filterEmptyLine).join(`
`),_e=[generatePrecision(a),"#define SHADER_TYPE "+a.shaderType,"#define SHADER_NAME "+a.shaderName,ot,a.useFog&&a.fog?"#define USE_FOG":"",a.useFog&&a.fogExp2?"#define FOG_EXP2":"",a.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",a.map?"#define USE_MAP":"",a.matcap?"#define USE_MATCAP":"",a.envMap?"#define USE_ENVMAP":"",a.envMap?"#define "+$:"",a.envMap?"#define "+tt:"",a.envMap?"#define "+rt:"",et?"#define CUBEUV_TEXEL_WIDTH "+et.texelWidth:"",et?"#define CUBEUV_TEXEL_HEIGHT "+et.texelHeight:"",et?"#define CUBEUV_MAX_MIP "+et.maxMip+".0":"",a.lightMap?"#define USE_LIGHTMAP":"",a.aoMap?"#define USE_AOMAP":"",a.bumpMap?"#define USE_BUMPMAP":"",a.normalMap?"#define USE_NORMALMAP":"",a.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",a.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",a.emissiveMap?"#define USE_EMISSIVEMAP":"",a.anisotropy?"#define USE_ANISOTROPY":"",a.anisotropyMap?"#define USE_ANISOTROPYMAP":"",a.clearcoat?"#define USE_CLEARCOAT":"",a.clearcoatMap?"#define USE_CLEARCOATMAP":"",a.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",a.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",a.iridescence?"#define USE_IRIDESCENCE":"",a.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",a.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",a.specularMap?"#define USE_SPECULARMAP":"",a.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",a.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",a.roughnessMap?"#define USE_ROUGHNESSMAP":"",a.metalnessMap?"#define USE_METALNESSMAP":"",a.alphaMap?"#define USE_ALPHAMAP":"",a.alphaTest?"#define USE_ALPHATEST":"",a.alphaHash?"#define USE_ALPHAHASH":"",a.sheen?"#define USE_SHEEN":"",a.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",a.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",a.transmission?"#define USE_TRANSMISSION":"",a.transmissionMap?"#define USE_TRANSMISSIONMAP":"",a.thicknessMap?"#define USE_THICKNESSMAP":"",a.vertexTangents&&a.flatShading===!1?"#define USE_TANGENT":"",a.vertexColors||a.instancingColor?"#define USE_COLOR":"",a.vertexAlphas?"#define USE_COLOR_ALPHA":"",a.vertexUv1s?"#define USE_UV1":"",a.vertexUv2s?"#define USE_UV2":"",a.vertexUv3s?"#define USE_UV3":"",a.pointsUvs?"#define USE_POINTS_UV":"",a.gradientMap?"#define USE_GRADIENTMAP":"",a.flatShading?"#define FLAT_SHADED":"",a.doubleSided?"#define DOUBLE_SIDED":"",a.flipSided?"#define FLIP_SIDED":"",a.shadowMapEnabled?"#define USE_SHADOWMAP":"",a.shadowMapEnabled?"#define "+b:"",a.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",a.numLightProbes>0?"#define USE_LIGHT_PROBES":"",a.useLegacyLights?"#define LEGACY_LIGHTS":"",a.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",a.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",a.toneMapping!==NoToneMapping?"#define TONE_MAPPING":"",a.toneMapping!==NoToneMapping?ShaderChunk.tonemapping_pars_fragment:"",a.toneMapping!==NoToneMapping?getToneMappingFunction("toneMapping",a.toneMapping):"",a.dithering?"#define DITHERING":"",a.opaque?"#define OPAQUE":"",ShaderChunk.colorspace_pars_fragment,getTexelEncodingFunction("linearToOutputTexel",a.outputColorSpace),a.useDepthPacking?"#define DEPTH_PACKING "+a.depthPacking:"",`
`].filter(filterEmptyLine).join(`
`)),g=resolveIncludes(g),g=replaceLightNums(g,a),g=replaceClippingPlaneNums(g,a),_=resolveIncludes(_),_=replaceLightNums(_,a),_=replaceClippingPlaneNums(_,a),g=unrollLoops(g),_=unrollLoops(_),a.isRawShaderMaterial!==!0&&(it=`#version 300 es
`,lt=[st,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+lt,_e=["#define varying in",a.glslVersion===GLSL3?"":"layout(location = 0) out highp vec4 pc_fragColor;",a.glslVersion===GLSL3?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+_e);const nt=it+lt+g,ct=it+_e+_,ht=WebGLShader(c,c.VERTEX_SHADER,nt),ft=WebGLShader(c,c.FRAGMENT_SHADER,ct);c.attachShader(at,ht),c.attachShader(at,ft),a.index0AttributeName!==void 0?c.bindAttribLocation(at,0,a.index0AttributeName):a.morphTargets===!0&&c.bindAttribLocation(at,0,"position"),c.linkProgram(at);function pt(Ct){if(s.debug.checkShaderErrors){const Pt=c.getProgramInfoLog(at).trim(),Tt=c.getShaderInfoLog(ht).trim(),Rt=c.getShaderInfoLog(ft).trim();let wt=!0,_t=!0;if(c.getProgramParameter(at,c.LINK_STATUS)===!1)if(wt=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(c,at,ht,ft);else{const St=getShaderErrors(c,ht,"vertex"),ut=getShaderErrors(c,ft,"fragment");console.error("THREE.WebGLProgram: Shader Error "+c.getError()+" - VALIDATE_STATUS "+c.getProgramParameter(at,c.VALIDATE_STATUS)+`

Material Name: `+Ct.name+`
Material Type: `+Ct.type+`

Program Info Log: `+Pt+`
`+St+`
`+ut)}else Pt!==""?console.warn("THREE.WebGLProgram: Program Info Log:",Pt):(Tt===""||Rt==="")&&(_t=!1);_t&&(Ct.diagnostics={runnable:wt,programLog:Pt,vertexShader:{log:Tt,prefix:lt},fragmentShader:{log:Rt,prefix:_e}})}c.deleteShader(ht),c.deleteShader(ft),yt=new WebGLUniforms(c,at),vt=fetchAttributeLocations(c,at)}let yt;this.getUniforms=function(){return yt===void 0&&pt(this),yt};let vt;this.getAttributes=function(){return vt===void 0&&pt(this),vt};let gt=a.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return gt===!1&&(gt=c.getProgramParameter(at,COMPLETION_STATUS_KHR)),gt},this.destroy=function(){o.releaseStatesOfProgram(this),c.deleteProgram(at),this.program=void 0},this.type=a.shaderType,this.name=a.shaderName,this.id=programIdCount++,this.cacheKey=e,this.usedTimes=1,this.program=at,this.vertexShader=ht,this.fragmentShader=ft,this}let _id$1=0;class WebGLShaderCache{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const a=e.vertexShader,o=e.fragmentShader,c=this._getShaderStage(a),d=this._getShaderStage(o),g=this._getShaderCacheForMaterial(e);return g.has(c)===!1&&(g.add(c),c.usedTimes++),g.has(d)===!1&&(g.add(d),d.usedTimes++),this}remove(e){const a=this.materialCache.get(e);for(const o of a)o.usedTimes--,o.usedTimes===0&&this.shaderCache.delete(o.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const a=this.materialCache;let o=a.get(e);return o===void 0&&(o=new Set,a.set(e,o)),o}_getShaderStage(e){const a=this.shaderCache;let o=a.get(e);return o===void 0&&(o=new WebGLShaderStage(e),a.set(e,o)),o}}class WebGLShaderStage{constructor(e){this.id=_id$1++,this.code=e,this.usedTimes=0}}function WebGLPrograms(s,e,a,o,c,d,g){const _=new Layers,b=new WebGLShaderCache,$=new Set,tt=[],rt=c.logarithmicDepthBuffer,et=c.vertexTextures;let st=c.precision;const ot={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function at(vt){return $.add(vt),vt===0?"uv":`uv${vt}`}function lt(vt,gt,Ct,Pt,Tt){const Rt=Pt.fog,wt=Tt.geometry,_t=vt.isMeshStandardMaterial?Pt.environment:null,St=(vt.isMeshStandardMaterial?a:e).get(vt.envMap||_t),ut=St&&St.mapping===CubeUVReflectionMapping?St.image.height:null,dt=ot[vt.type];vt.precision!==null&&(st=c.getMaxPrecision(vt.precision),st!==vt.precision&&console.warn("THREE.WebGLProgram.getParameters:",vt.precision,"not supported, using",st,"instead."));const Mt=wt.morphAttributes.position||wt.morphAttributes.normal||wt.morphAttributes.color,At=Mt!==void 0?Mt.length:0;let Bt=0;wt.morphAttributes.position!==void 0&&(Bt=1),wt.morphAttributes.normal!==void 0&&(Bt=2),wt.morphAttributes.color!==void 0&&(Bt=3);let Xt,It,Vt,Wt;if(dt){const On=ShaderLib[dt];Xt=On.vertexShader,It=On.fragmentShader}else Xt=vt.vertexShader,It=vt.fragmentShader,b.update(vt),Vt=b.getVertexShaderID(vt),Wt=b.getFragmentShaderID(vt);const Kt=s.getRenderTarget(),ln=Tt.isInstancedMesh===!0,fn=Tt.isBatchedMesh===!0,dn=!!vt.map,Lt=!!vt.matcap,pn=!!St,Jt=!!vt.aoMap,Qt=!!vt.lightMap,cn=!!vt.bumpMap,En=!!vt.normalMap,bt=!!vt.displacementMap,xt=!!vt.emissiveMap,Ft=!!vt.metalnessMap,Gt=!!vt.roughnessMap,zt=vt.anisotropy>0,jt=vt.clearcoat>0,on=vt.iridescence>0,Yt=vt.sheen>0,rn=vt.transmission>0,sn=zt&&!!vt.anisotropyMap,qt=jt&&!!vt.clearcoatMap,$t=jt&&!!vt.clearcoatNormalMap,mn=jt&&!!vt.clearcoatRoughnessMap,nn=on&&!!vt.iridescenceMap,an=on&&!!vt.iridescenceThicknessMap,An=Yt&&!!vt.sheenColorMap,Tn=Yt&&!!vt.sheenRoughnessMap,Pn=!!vt.specularMap,Cn=!!vt.specularColorMap,wn=!!vt.specularIntensityMap,un=rn&&!!vt.transmissionMap,mt=rn&&!!vt.thicknessMap,kt=!!vt.gradientMap,Ht=!!vt.alphaMap,Zt=vt.alphaTest>0,tn=!!vt.alphaHash,bn=!!vt.extensions;let Mn=NoToneMapping;vt.toneMapped&&(Kt===null||Kt.isXRRenderTarget===!0)&&(Mn=s.toneMapping);const In={shaderID:dt,shaderType:vt.type,shaderName:vt.name,vertexShader:Xt,fragmentShader:It,defines:vt.defines,customVertexShaderID:Vt,customFragmentShaderID:Wt,isRawShaderMaterial:vt.isRawShaderMaterial===!0,glslVersion:vt.glslVersion,precision:st,batching:fn,instancing:ln,instancingColor:ln&&Tt.instanceColor!==null,instancingMorph:ln&&Tt.morphTexture!==null,supportsVertexTextures:et,outputColorSpace:Kt===null?s.outputColorSpace:Kt.isXRRenderTarget===!0?Kt.texture.colorSpace:LinearSRGBColorSpace,alphaToCoverage:!!vt.alphaToCoverage,map:dn,matcap:Lt,envMap:pn,envMapMode:pn&&St.mapping,envMapCubeUVHeight:ut,aoMap:Jt,lightMap:Qt,bumpMap:cn,normalMap:En,displacementMap:et&&bt,emissiveMap:xt,normalMapObjectSpace:En&&vt.normalMapType===ObjectSpaceNormalMap,normalMapTangentSpace:En&&vt.normalMapType===TangentSpaceNormalMap,metalnessMap:Ft,roughnessMap:Gt,anisotropy:zt,anisotropyMap:sn,clearcoat:jt,clearcoatMap:qt,clearcoatNormalMap:$t,clearcoatRoughnessMap:mn,iridescence:on,iridescenceMap:nn,iridescenceThicknessMap:an,sheen:Yt,sheenColorMap:An,sheenRoughnessMap:Tn,specularMap:Pn,specularColorMap:Cn,specularIntensityMap:wn,transmission:rn,transmissionMap:un,thicknessMap:mt,gradientMap:kt,opaque:vt.transparent===!1&&vt.blending===NormalBlending&&vt.alphaToCoverage===!1,alphaMap:Ht,alphaTest:Zt,alphaHash:tn,combine:vt.combine,mapUv:dn&&at(vt.map.channel),aoMapUv:Jt&&at(vt.aoMap.channel),lightMapUv:Qt&&at(vt.lightMap.channel),bumpMapUv:cn&&at(vt.bumpMap.channel),normalMapUv:En&&at(vt.normalMap.channel),displacementMapUv:bt&&at(vt.displacementMap.channel),emissiveMapUv:xt&&at(vt.emissiveMap.channel),metalnessMapUv:Ft&&at(vt.metalnessMap.channel),roughnessMapUv:Gt&&at(vt.roughnessMap.channel),anisotropyMapUv:sn&&at(vt.anisotropyMap.channel),clearcoatMapUv:qt&&at(vt.clearcoatMap.channel),clearcoatNormalMapUv:$t&&at(vt.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:mn&&at(vt.clearcoatRoughnessMap.channel),iridescenceMapUv:nn&&at(vt.iridescenceMap.channel),iridescenceThicknessMapUv:an&&at(vt.iridescenceThicknessMap.channel),sheenColorMapUv:An&&at(vt.sheenColorMap.channel),sheenRoughnessMapUv:Tn&&at(vt.sheenRoughnessMap.channel),specularMapUv:Pn&&at(vt.specularMap.channel),specularColorMapUv:Cn&&at(vt.specularColorMap.channel),specularIntensityMapUv:wn&&at(vt.specularIntensityMap.channel),transmissionMapUv:un&&at(vt.transmissionMap.channel),thicknessMapUv:mt&&at(vt.thicknessMap.channel),alphaMapUv:Ht&&at(vt.alphaMap.channel),vertexTangents:!!wt.attributes.tangent&&(En||zt),vertexColors:vt.vertexColors,vertexAlphas:vt.vertexColors===!0&&!!wt.attributes.color&&wt.attributes.color.itemSize===4,pointsUvs:Tt.isPoints===!0&&!!wt.attributes.uv&&(dn||Ht),fog:!!Rt,useFog:vt.fog===!0,fogExp2:!!Rt&&Rt.isFogExp2,flatShading:vt.flatShading===!0,sizeAttenuation:vt.sizeAttenuation===!0,logarithmicDepthBuffer:rt,skinning:Tt.isSkinnedMesh===!0,morphTargets:wt.morphAttributes.position!==void 0,morphNormals:wt.morphAttributes.normal!==void 0,morphColors:wt.morphAttributes.color!==void 0,morphTargetsCount:At,morphTextureStride:Bt,numDirLights:gt.directional.length,numPointLights:gt.point.length,numSpotLights:gt.spot.length,numSpotLightMaps:gt.spotLightMap.length,numRectAreaLights:gt.rectArea.length,numHemiLights:gt.hemi.length,numDirLightShadows:gt.directionalShadowMap.length,numPointLightShadows:gt.pointShadowMap.length,numSpotLightShadows:gt.spotShadowMap.length,numSpotLightShadowsWithMaps:gt.numSpotLightShadowsWithMaps,numLightProbes:gt.numLightProbes,numClippingPlanes:g.numPlanes,numClipIntersection:g.numIntersection,dithering:vt.dithering,shadowMapEnabled:s.shadowMap.enabled&&Ct.length>0,shadowMapType:s.shadowMap.type,toneMapping:Mn,useLegacyLights:s._useLegacyLights,decodeVideoTexture:dn&&vt.map.isVideoTexture===!0&&ColorManagement.getTransfer(vt.map.colorSpace)===SRGBTransfer,premultipliedAlpha:vt.premultipliedAlpha,doubleSided:vt.side===DoubleSide,flipSided:vt.side===BackSide,useDepthPacking:vt.depthPacking>=0,depthPacking:vt.depthPacking||0,index0AttributeName:vt.index0AttributeName,extensionClipCullDistance:bn&&vt.extensions.clipCullDistance===!0&&o.has("WEBGL_clip_cull_distance"),extensionMultiDraw:bn&&vt.extensions.multiDraw===!0&&o.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:o.has("KHR_parallel_shader_compile"),customProgramCacheKey:vt.customProgramCacheKey()};return In.vertexUv1s=$.has(1),In.vertexUv2s=$.has(2),In.vertexUv3s=$.has(3),$.clear(),In}function _e(vt){const gt=[];if(vt.shaderID?gt.push(vt.shaderID):(gt.push(vt.customVertexShaderID),gt.push(vt.customFragmentShaderID)),vt.defines!==void 0)for(const Ct in vt.defines)gt.push(Ct),gt.push(vt.defines[Ct]);return vt.isRawShaderMaterial===!1&&(it(gt,vt),nt(gt,vt),gt.push(s.outputColorSpace)),gt.push(vt.customProgramCacheKey),gt.join()}function it(vt,gt){vt.push(gt.precision),vt.push(gt.outputColorSpace),vt.push(gt.envMapMode),vt.push(gt.envMapCubeUVHeight),vt.push(gt.mapUv),vt.push(gt.alphaMapUv),vt.push(gt.lightMapUv),vt.push(gt.aoMapUv),vt.push(gt.bumpMapUv),vt.push(gt.normalMapUv),vt.push(gt.displacementMapUv),vt.push(gt.emissiveMapUv),vt.push(gt.metalnessMapUv),vt.push(gt.roughnessMapUv),vt.push(gt.anisotropyMapUv),vt.push(gt.clearcoatMapUv),vt.push(gt.clearcoatNormalMapUv),vt.push(gt.clearcoatRoughnessMapUv),vt.push(gt.iridescenceMapUv),vt.push(gt.iridescenceThicknessMapUv),vt.push(gt.sheenColorMapUv),vt.push(gt.sheenRoughnessMapUv),vt.push(gt.specularMapUv),vt.push(gt.specularColorMapUv),vt.push(gt.specularIntensityMapUv),vt.push(gt.transmissionMapUv),vt.push(gt.thicknessMapUv),vt.push(gt.combine),vt.push(gt.fogExp2),vt.push(gt.sizeAttenuation),vt.push(gt.morphTargetsCount),vt.push(gt.morphAttributeCount),vt.push(gt.numDirLights),vt.push(gt.numPointLights),vt.push(gt.numSpotLights),vt.push(gt.numSpotLightMaps),vt.push(gt.numHemiLights),vt.push(gt.numRectAreaLights),vt.push(gt.numDirLightShadows),vt.push(gt.numPointLightShadows),vt.push(gt.numSpotLightShadows),vt.push(gt.numSpotLightShadowsWithMaps),vt.push(gt.numLightProbes),vt.push(gt.shadowMapType),vt.push(gt.toneMapping),vt.push(gt.numClippingPlanes),vt.push(gt.numClipIntersection),vt.push(gt.depthPacking)}function nt(vt,gt){_.disableAll(),gt.supportsVertexTextures&&_.enable(0),gt.instancing&&_.enable(1),gt.instancingColor&&_.enable(2),gt.instancingMorph&&_.enable(3),gt.matcap&&_.enable(4),gt.envMap&&_.enable(5),gt.normalMapObjectSpace&&_.enable(6),gt.normalMapTangentSpace&&_.enable(7),gt.clearcoat&&_.enable(8),gt.iridescence&&_.enable(9),gt.alphaTest&&_.enable(10),gt.vertexColors&&_.enable(11),gt.vertexAlphas&&_.enable(12),gt.vertexUv1s&&_.enable(13),gt.vertexUv2s&&_.enable(14),gt.vertexUv3s&&_.enable(15),gt.vertexTangents&&_.enable(16),gt.anisotropy&&_.enable(17),gt.alphaHash&&_.enable(18),gt.batching&&_.enable(19),vt.push(_.mask),_.disableAll(),gt.fog&&_.enable(0),gt.useFog&&_.enable(1),gt.flatShading&&_.enable(2),gt.logarithmicDepthBuffer&&_.enable(3),gt.skinning&&_.enable(4),gt.morphTargets&&_.enable(5),gt.morphNormals&&_.enable(6),gt.morphColors&&_.enable(7),gt.premultipliedAlpha&&_.enable(8),gt.shadowMapEnabled&&_.enable(9),gt.useLegacyLights&&_.enable(10),gt.doubleSided&&_.enable(11),gt.flipSided&&_.enable(12),gt.useDepthPacking&&_.enable(13),gt.dithering&&_.enable(14),gt.transmission&&_.enable(15),gt.sheen&&_.enable(16),gt.opaque&&_.enable(17),gt.pointsUvs&&_.enable(18),gt.decodeVideoTexture&&_.enable(19),gt.alphaToCoverage&&_.enable(20),vt.push(_.mask)}function ct(vt){const gt=ot[vt.type];let Ct;if(gt){const Pt=ShaderLib[gt];Ct=UniformsUtils.clone(Pt.uniforms)}else Ct=vt.uniforms;return Ct}function ht(vt,gt){let Ct;for(let Pt=0,Tt=tt.length;Pt<Tt;Pt++){const Rt=tt[Pt];if(Rt.cacheKey===gt){Ct=Rt,++Ct.usedTimes;break}}return Ct===void 0&&(Ct=new WebGLProgram(s,gt,vt,d),tt.push(Ct)),Ct}function ft(vt){if(--vt.usedTimes===0){const gt=tt.indexOf(vt);tt[gt]=tt[tt.length-1],tt.pop(),vt.destroy()}}function pt(vt){b.remove(vt)}function yt(){b.dispose()}return{getParameters:lt,getProgramCacheKey:_e,getUniforms:ct,acquireProgram:ht,releaseProgram:ft,releaseShaderCache:pt,programs:tt,dispose:yt}}function WebGLProperties(){let s=new WeakMap;function e(d){let g=s.get(d);return g===void 0&&(g={},s.set(d,g)),g}function a(d){s.delete(d)}function o(d,g,_){s.get(d)[g]=_}function c(){s=new WeakMap}return{get:e,remove:a,update:o,dispose:c}}function painterSortStable(s,e){return s.groupOrder!==e.groupOrder?s.groupOrder-e.groupOrder:s.renderOrder!==e.renderOrder?s.renderOrder-e.renderOrder:s.material.id!==e.material.id?s.material.id-e.material.id:s.z!==e.z?s.z-e.z:s.id-e.id}function reversePainterSortStable(s,e){return s.groupOrder!==e.groupOrder?s.groupOrder-e.groupOrder:s.renderOrder!==e.renderOrder?s.renderOrder-e.renderOrder:s.z!==e.z?e.z-s.z:s.id-e.id}function WebGLRenderList(){const s=[];let e=0;const a=[],o=[],c=[];function d(){e=0,a.length=0,o.length=0,c.length=0}function g(rt,et,st,ot,at,lt){let _e=s[e];return _e===void 0?(_e={id:rt.id,object:rt,geometry:et,material:st,groupOrder:ot,renderOrder:rt.renderOrder,z:at,group:lt},s[e]=_e):(_e.id=rt.id,_e.object=rt,_e.geometry=et,_e.material=st,_e.groupOrder=ot,_e.renderOrder=rt.renderOrder,_e.z=at,_e.group=lt),e++,_e}function _(rt,et,st,ot,at,lt){const _e=g(rt,et,st,ot,at,lt);st.transmission>0?o.push(_e):st.transparent===!0?c.push(_e):a.push(_e)}function b(rt,et,st,ot,at,lt){const _e=g(rt,et,st,ot,at,lt);st.transmission>0?o.unshift(_e):st.transparent===!0?c.unshift(_e):a.unshift(_e)}function $(rt,et){a.length>1&&a.sort(rt||painterSortStable),o.length>1&&o.sort(et||reversePainterSortStable),c.length>1&&c.sort(et||reversePainterSortStable)}function tt(){for(let rt=e,et=s.length;rt<et;rt++){const st=s[rt];if(st.id===null)break;st.id=null,st.object=null,st.geometry=null,st.material=null,st.group=null}}return{opaque:a,transmissive:o,transparent:c,init:d,push:_,unshift:b,finish:tt,sort:$}}function WebGLRenderLists(){let s=new WeakMap;function e(o,c){const d=s.get(o);let g;return d===void 0?(g=new WebGLRenderList,s.set(o,[g])):c>=d.length?(g=new WebGLRenderList,d.push(g)):g=d[c],g}function a(){s=new WeakMap}return{get:e,dispose:a}}function UniformsCache(){const s={};return{get:function(e){if(s[e.id]!==void 0)return s[e.id];let a;switch(e.type){case"DirectionalLight":a={direction:new Vector3,color:new Color};break;case"SpotLight":a={position:new Vector3,direction:new Vector3,color:new Color,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":a={position:new Vector3,color:new Color,distance:0,decay:0};break;case"HemisphereLight":a={direction:new Vector3,skyColor:new Color,groundColor:new Color};break;case"RectAreaLight":a={color:new Color,position:new Vector3,halfWidth:new Vector3,halfHeight:new Vector3};break}return s[e.id]=a,a}}}function ShadowUniformsCache(){const s={};return{get:function(e){if(s[e.id]!==void 0)return s[e.id];let a;switch(e.type){case"DirectionalLight":a={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Vector2};break;case"SpotLight":a={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Vector2};break;case"PointLight":a={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Vector2,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[e.id]=a,a}}}let nextVersion=0;function shadowCastingAndTexturingLightsFirst(s,e){return(e.castShadow?2:0)-(s.castShadow?2:0)+(e.map?1:0)-(s.map?1:0)}function WebGLLights(s){const e=new UniformsCache,a=ShadowUniformsCache(),o={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let $=0;$<9;$++)o.probe.push(new Vector3);const c=new Vector3,d=new Matrix4,g=new Matrix4;function _($,tt){let rt=0,et=0,st=0;for(let Ct=0;Ct<9;Ct++)o.probe[Ct].set(0,0,0);let ot=0,at=0,lt=0,_e=0,it=0,nt=0,ct=0,ht=0,ft=0,pt=0,yt=0;$.sort(shadowCastingAndTexturingLightsFirst);const vt=tt===!0?Math.PI:1;for(let Ct=0,Pt=$.length;Ct<Pt;Ct++){const Tt=$[Ct],Rt=Tt.color,wt=Tt.intensity,_t=Tt.distance,St=Tt.shadow&&Tt.shadow.map?Tt.shadow.map.texture:null;if(Tt.isAmbientLight)rt+=Rt.r*wt*vt,et+=Rt.g*wt*vt,st+=Rt.b*wt*vt;else if(Tt.isLightProbe){for(let ut=0;ut<9;ut++)o.probe[ut].addScaledVector(Tt.sh.coefficients[ut],wt);yt++}else if(Tt.isDirectionalLight){const ut=e.get(Tt);if(ut.color.copy(Tt.color).multiplyScalar(Tt.intensity*vt),Tt.castShadow){const dt=Tt.shadow,Mt=a.get(Tt);Mt.shadowBias=dt.bias,Mt.shadowNormalBias=dt.normalBias,Mt.shadowRadius=dt.radius,Mt.shadowMapSize=dt.mapSize,o.directionalShadow[ot]=Mt,o.directionalShadowMap[ot]=St,o.directionalShadowMatrix[ot]=Tt.shadow.matrix,nt++}o.directional[ot]=ut,ot++}else if(Tt.isSpotLight){const ut=e.get(Tt);ut.position.setFromMatrixPosition(Tt.matrixWorld),ut.color.copy(Rt).multiplyScalar(wt*vt),ut.distance=_t,ut.coneCos=Math.cos(Tt.angle),ut.penumbraCos=Math.cos(Tt.angle*(1-Tt.penumbra)),ut.decay=Tt.decay,o.spot[lt]=ut;const dt=Tt.shadow;if(Tt.map&&(o.spotLightMap[ft]=Tt.map,ft++,dt.updateMatrices(Tt),Tt.castShadow&&pt++),o.spotLightMatrix[lt]=dt.matrix,Tt.castShadow){const Mt=a.get(Tt);Mt.shadowBias=dt.bias,Mt.shadowNormalBias=dt.normalBias,Mt.shadowRadius=dt.radius,Mt.shadowMapSize=dt.mapSize,o.spotShadow[lt]=Mt,o.spotShadowMap[lt]=St,ht++}lt++}else if(Tt.isRectAreaLight){const ut=e.get(Tt);ut.color.copy(Rt).multiplyScalar(wt),ut.halfWidth.set(Tt.width*.5,0,0),ut.halfHeight.set(0,Tt.height*.5,0),o.rectArea[_e]=ut,_e++}else if(Tt.isPointLight){const ut=e.get(Tt);if(ut.color.copy(Tt.color).multiplyScalar(Tt.intensity*vt),ut.distance=Tt.distance,ut.decay=Tt.decay,Tt.castShadow){const dt=Tt.shadow,Mt=a.get(Tt);Mt.shadowBias=dt.bias,Mt.shadowNormalBias=dt.normalBias,Mt.shadowRadius=dt.radius,Mt.shadowMapSize=dt.mapSize,Mt.shadowCameraNear=dt.camera.near,Mt.shadowCameraFar=dt.camera.far,o.pointShadow[at]=Mt,o.pointShadowMap[at]=St,o.pointShadowMatrix[at]=Tt.shadow.matrix,ct++}o.point[at]=ut,at++}else if(Tt.isHemisphereLight){const ut=e.get(Tt);ut.skyColor.copy(Tt.color).multiplyScalar(wt*vt),ut.groundColor.copy(Tt.groundColor).multiplyScalar(wt*vt),o.hemi[it]=ut,it++}}_e>0&&(s.has("OES_texture_float_linear")===!0?(o.rectAreaLTC1=UniformsLib.LTC_FLOAT_1,o.rectAreaLTC2=UniformsLib.LTC_FLOAT_2):(o.rectAreaLTC1=UniformsLib.LTC_HALF_1,o.rectAreaLTC2=UniformsLib.LTC_HALF_2)),o.ambient[0]=rt,o.ambient[1]=et,o.ambient[2]=st;const gt=o.hash;(gt.directionalLength!==ot||gt.pointLength!==at||gt.spotLength!==lt||gt.rectAreaLength!==_e||gt.hemiLength!==it||gt.numDirectionalShadows!==nt||gt.numPointShadows!==ct||gt.numSpotShadows!==ht||gt.numSpotMaps!==ft||gt.numLightProbes!==yt)&&(o.directional.length=ot,o.spot.length=lt,o.rectArea.length=_e,o.point.length=at,o.hemi.length=it,o.directionalShadow.length=nt,o.directionalShadowMap.length=nt,o.pointShadow.length=ct,o.pointShadowMap.length=ct,o.spotShadow.length=ht,o.spotShadowMap.length=ht,o.directionalShadowMatrix.length=nt,o.pointShadowMatrix.length=ct,o.spotLightMatrix.length=ht+ft-pt,o.spotLightMap.length=ft,o.numSpotLightShadowsWithMaps=pt,o.numLightProbes=yt,gt.directionalLength=ot,gt.pointLength=at,gt.spotLength=lt,gt.rectAreaLength=_e,gt.hemiLength=it,gt.numDirectionalShadows=nt,gt.numPointShadows=ct,gt.numSpotShadows=ht,gt.numSpotMaps=ft,gt.numLightProbes=yt,o.version=nextVersion++)}function b($,tt){let rt=0,et=0,st=0,ot=0,at=0;const lt=tt.matrixWorldInverse;for(let _e=0,it=$.length;_e<it;_e++){const nt=$[_e];if(nt.isDirectionalLight){const ct=o.directional[rt];ct.direction.setFromMatrixPosition(nt.matrixWorld),c.setFromMatrixPosition(nt.target.matrixWorld),ct.direction.sub(c),ct.direction.transformDirection(lt),rt++}else if(nt.isSpotLight){const ct=o.spot[st];ct.position.setFromMatrixPosition(nt.matrixWorld),ct.position.applyMatrix4(lt),ct.direction.setFromMatrixPosition(nt.matrixWorld),c.setFromMatrixPosition(nt.target.matrixWorld),ct.direction.sub(c),ct.direction.transformDirection(lt),st++}else if(nt.isRectAreaLight){const ct=o.rectArea[ot];ct.position.setFromMatrixPosition(nt.matrixWorld),ct.position.applyMatrix4(lt),g.identity(),d.copy(nt.matrixWorld),d.premultiply(lt),g.extractRotation(d),ct.halfWidth.set(nt.width*.5,0,0),ct.halfHeight.set(0,nt.height*.5,0),ct.halfWidth.applyMatrix4(g),ct.halfHeight.applyMatrix4(g),ot++}else if(nt.isPointLight){const ct=o.point[et];ct.position.setFromMatrixPosition(nt.matrixWorld),ct.position.applyMatrix4(lt),et++}else if(nt.isHemisphereLight){const ct=o.hemi[at];ct.direction.setFromMatrixPosition(nt.matrixWorld),ct.direction.transformDirection(lt),at++}}}return{setup:_,setupView:b,state:o}}function WebGLRenderState(s){const e=new WebGLLights(s),a=[],o=[];function c(){a.length=0,o.length=0}function d(tt){a.push(tt)}function g(tt){o.push(tt)}function _(tt){e.setup(a,tt)}function b(tt){e.setupView(a,tt)}return{init:c,state:{lightsArray:a,shadowsArray:o,lights:e,transmissionRenderTarget:null},setupLights:_,setupLightsView:b,pushLight:d,pushShadow:g}}function WebGLRenderStates(s){let e=new WeakMap;function a(c,d=0){const g=e.get(c);let _;return g===void 0?(_=new WebGLRenderState(s),e.set(c,[_])):d>=g.length?(_=new WebGLRenderState(s),g.push(_)):_=g[d],_}function o(){e=new WeakMap}return{get:a,dispose:o}}class MeshDepthMaterial extends Material{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=BasicDepthPacking,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class MeshDistanceMaterial extends Material{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}const vertex=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,fragment=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function WebGLShadowMap(s,e,a){let o=new Frustum;const c=new Vector2,d=new Vector2,g=new Vector4,_=new MeshDepthMaterial({depthPacking:RGBADepthPacking}),b=new MeshDistanceMaterial,$={},tt=a.maxTextureSize,rt={[FrontSide]:BackSide,[BackSide]:FrontSide,[DoubleSide]:DoubleSide},et=new ShaderMaterial({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Vector2},radius:{value:4}},vertexShader:vertex,fragmentShader:fragment}),st=et.clone();st.defines.HORIZONTAL_PASS=1;const ot=new BufferGeometry;ot.setAttribute("position",new BufferAttribute(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const at=new Mesh(ot,et),lt=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=PCFShadowMap;let _e=this.type;this.render=function(ft,pt,yt){if(lt.enabled===!1||lt.autoUpdate===!1&&lt.needsUpdate===!1||ft.length===0)return;const vt=s.getRenderTarget(),gt=s.getActiveCubeFace(),Ct=s.getActiveMipmapLevel(),Pt=s.state;Pt.setBlending(NoBlending),Pt.buffers.color.setClear(1,1,1,1),Pt.buffers.depth.setTest(!0),Pt.setScissorTest(!1);const Tt=_e!==VSMShadowMap&&this.type===VSMShadowMap,Rt=_e===VSMShadowMap&&this.type!==VSMShadowMap;for(let wt=0,_t=ft.length;wt<_t;wt++){const St=ft[wt],ut=St.shadow;if(ut===void 0){console.warn("THREE.WebGLShadowMap:",St,"has no shadow.");continue}if(ut.autoUpdate===!1&&ut.needsUpdate===!1)continue;c.copy(ut.mapSize);const dt=ut.getFrameExtents();if(c.multiply(dt),d.copy(ut.mapSize),(c.x>tt||c.y>tt)&&(c.x>tt&&(d.x=Math.floor(tt/dt.x),c.x=d.x*dt.x,ut.mapSize.x=d.x),c.y>tt&&(d.y=Math.floor(tt/dt.y),c.y=d.y*dt.y,ut.mapSize.y=d.y)),ut.map===null||Tt===!0||Rt===!0){const At=this.type!==VSMShadowMap?{minFilter:NearestFilter,magFilter:NearestFilter}:{};ut.map!==null&&ut.map.dispose(),ut.map=new WebGLRenderTarget(c.x,c.y,At),ut.map.texture.name=St.name+".shadowMap",ut.camera.updateProjectionMatrix()}s.setRenderTarget(ut.map),s.clear();const Mt=ut.getViewportCount();for(let At=0;At<Mt;At++){const Bt=ut.getViewport(At);g.set(d.x*Bt.x,d.y*Bt.y,d.x*Bt.z,d.y*Bt.w),Pt.viewport(g),ut.updateMatrices(St,At),o=ut.getFrustum(),ct(pt,yt,ut.camera,St,this.type)}ut.isPointLightShadow!==!0&&this.type===VSMShadowMap&&it(ut,yt),ut.needsUpdate=!1}_e=this.type,lt.needsUpdate=!1,s.setRenderTarget(vt,gt,Ct)};function it(ft,pt){const yt=e.update(at);et.defines.VSM_SAMPLES!==ft.blurSamples&&(et.defines.VSM_SAMPLES=ft.blurSamples,st.defines.VSM_SAMPLES=ft.blurSamples,et.needsUpdate=!0,st.needsUpdate=!0),ft.mapPass===null&&(ft.mapPass=new WebGLRenderTarget(c.x,c.y)),et.uniforms.shadow_pass.value=ft.map.texture,et.uniforms.resolution.value=ft.mapSize,et.uniforms.radius.value=ft.radius,s.setRenderTarget(ft.mapPass),s.clear(),s.renderBufferDirect(pt,null,yt,et,at,null),st.uniforms.shadow_pass.value=ft.mapPass.texture,st.uniforms.resolution.value=ft.mapSize,st.uniforms.radius.value=ft.radius,s.setRenderTarget(ft.map),s.clear(),s.renderBufferDirect(pt,null,yt,st,at,null)}function nt(ft,pt,yt,vt){let gt=null;const Ct=yt.isPointLight===!0?ft.customDistanceMaterial:ft.customDepthMaterial;if(Ct!==void 0)gt=Ct;else if(gt=yt.isPointLight===!0?b:_,s.localClippingEnabled&&pt.clipShadows===!0&&Array.isArray(pt.clippingPlanes)&&pt.clippingPlanes.length!==0||pt.displacementMap&&pt.displacementScale!==0||pt.alphaMap&&pt.alphaTest>0||pt.map&&pt.alphaTest>0){const Pt=gt.uuid,Tt=pt.uuid;let Rt=$[Pt];Rt===void 0&&(Rt={},$[Pt]=Rt);let wt=Rt[Tt];wt===void 0&&(wt=gt.clone(),Rt[Tt]=wt,pt.addEventListener("dispose",ht)),gt=wt}if(gt.visible=pt.visible,gt.wireframe=pt.wireframe,vt===VSMShadowMap?gt.side=pt.shadowSide!==null?pt.shadowSide:pt.side:gt.side=pt.shadowSide!==null?pt.shadowSide:rt[pt.side],gt.alphaMap=pt.alphaMap,gt.alphaTest=pt.alphaTest,gt.map=pt.map,gt.clipShadows=pt.clipShadows,gt.clippingPlanes=pt.clippingPlanes,gt.clipIntersection=pt.clipIntersection,gt.displacementMap=pt.displacementMap,gt.displacementScale=pt.displacementScale,gt.displacementBias=pt.displacementBias,gt.wireframeLinewidth=pt.wireframeLinewidth,gt.linewidth=pt.linewidth,yt.isPointLight===!0&&gt.isMeshDistanceMaterial===!0){const Pt=s.properties.get(gt);Pt.light=yt}return gt}function ct(ft,pt,yt,vt,gt){if(ft.visible===!1)return;if(ft.layers.test(pt.layers)&&(ft.isMesh||ft.isLine||ft.isPoints)&&(ft.castShadow||ft.receiveShadow&&gt===VSMShadowMap)&&(!ft.frustumCulled||o.intersectsObject(ft))){ft.modelViewMatrix.multiplyMatrices(yt.matrixWorldInverse,ft.matrixWorld);const Tt=e.update(ft),Rt=ft.material;if(Array.isArray(Rt)){const wt=Tt.groups;for(let _t=0,St=wt.length;_t<St;_t++){const ut=wt[_t],dt=Rt[ut.materialIndex];if(dt&&dt.visible){const Mt=nt(ft,dt,vt,gt);ft.onBeforeShadow(s,ft,pt,yt,Tt,Mt,ut),s.renderBufferDirect(yt,null,Tt,Mt,ft,ut),ft.onAfterShadow(s,ft,pt,yt,Tt,Mt,ut)}}}else if(Rt.visible){const wt=nt(ft,Rt,vt,gt);ft.onBeforeShadow(s,ft,pt,yt,Tt,wt,null),s.renderBufferDirect(yt,null,Tt,wt,ft,null),ft.onAfterShadow(s,ft,pt,yt,Tt,wt,null)}}const Pt=ft.children;for(let Tt=0,Rt=Pt.length;Tt<Rt;Tt++)ct(Pt[Tt],pt,yt,vt,gt)}function ht(ft){ft.target.removeEventListener("dispose",ht);for(const yt in $){const vt=$[yt],gt=ft.target.uuid;gt in vt&&(vt[gt].dispose(),delete vt[gt])}}}function WebGLState(s){function e(){let mt=!1;const kt=new Vector4;let Ht=null;const Zt=new Vector4(0,0,0,0);return{setMask:function(tn){Ht!==tn&&!mt&&(s.colorMask(tn,tn,tn,tn),Ht=tn)},setLocked:function(tn){mt=tn},setClear:function(tn,bn,Mn,In,On){On===!0&&(tn*=In,bn*=In,Mn*=In),kt.set(tn,bn,Mn,In),Zt.equals(kt)===!1&&(s.clearColor(tn,bn,Mn,In),Zt.copy(kt))},reset:function(){mt=!1,Ht=null,Zt.set(-1,0,0,0)}}}function a(){let mt=!1,kt=null,Ht=null,Zt=null;return{setTest:function(tn){tn?Wt(s.DEPTH_TEST):Kt(s.DEPTH_TEST)},setMask:function(tn){kt!==tn&&!mt&&(s.depthMask(tn),kt=tn)},setFunc:function(tn){if(Ht!==tn){switch(tn){case NeverDepth:s.depthFunc(s.NEVER);break;case AlwaysDepth:s.depthFunc(s.ALWAYS);break;case LessDepth:s.depthFunc(s.LESS);break;case LessEqualDepth:s.depthFunc(s.LEQUAL);break;case EqualDepth:s.depthFunc(s.EQUAL);break;case GreaterEqualDepth:s.depthFunc(s.GEQUAL);break;case GreaterDepth:s.depthFunc(s.GREATER);break;case NotEqualDepth:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}Ht=tn}},setLocked:function(tn){mt=tn},setClear:function(tn){Zt!==tn&&(s.clearDepth(tn),Zt=tn)},reset:function(){mt=!1,kt=null,Ht=null,Zt=null}}}function o(){let mt=!1,kt=null,Ht=null,Zt=null,tn=null,bn=null,Mn=null,In=null,On=null;return{setTest:function(Rn){mt||(Rn?Wt(s.STENCIL_TEST):Kt(s.STENCIL_TEST))},setMask:function(Rn){kt!==Rn&&!mt&&(s.stencilMask(Rn),kt=Rn)},setFunc:function(Rn,kn,Nn){(Ht!==Rn||Zt!==kn||tn!==Nn)&&(s.stencilFunc(Rn,kn,Nn),Ht=Rn,Zt=kn,tn=Nn)},setOp:function(Rn,kn,Nn){(bn!==Rn||Mn!==kn||In!==Nn)&&(s.stencilOp(Rn,kn,Nn),bn=Rn,Mn=kn,In=Nn)},setLocked:function(Rn){mt=Rn},setClear:function(Rn){On!==Rn&&(s.clearStencil(Rn),On=Rn)},reset:function(){mt=!1,kt=null,Ht=null,Zt=null,tn=null,bn=null,Mn=null,In=null,On=null}}}const c=new e,d=new a,g=new o,_=new WeakMap,b=new WeakMap;let $={},tt={},rt=new WeakMap,et=[],st=null,ot=!1,at=null,lt=null,_e=null,it=null,nt=null,ct=null,ht=null,ft=new Color(0,0,0),pt=0,yt=!1,vt=null,gt=null,Ct=null,Pt=null,Tt=null;const Rt=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let wt=!1,_t=0;const St=s.getParameter(s.VERSION);St.indexOf("WebGL")!==-1?(_t=parseFloat(/^WebGL (\d)/.exec(St)[1]),wt=_t>=1):St.indexOf("OpenGL ES")!==-1&&(_t=parseFloat(/^OpenGL ES (\d)/.exec(St)[1]),wt=_t>=2);let ut=null,dt={};const Mt=s.getParameter(s.SCISSOR_BOX),At=s.getParameter(s.VIEWPORT),Bt=new Vector4().fromArray(Mt),Xt=new Vector4().fromArray(At);function It(mt,kt,Ht,Zt){const tn=new Uint8Array(4),bn=s.createTexture();s.bindTexture(mt,bn),s.texParameteri(mt,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(mt,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let Mn=0;Mn<Ht;Mn++)mt===s.TEXTURE_3D||mt===s.TEXTURE_2D_ARRAY?s.texImage3D(kt,0,s.RGBA,1,1,Zt,0,s.RGBA,s.UNSIGNED_BYTE,tn):s.texImage2D(kt+Mn,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,tn);return bn}const Vt={};Vt[s.TEXTURE_2D]=It(s.TEXTURE_2D,s.TEXTURE_2D,1),Vt[s.TEXTURE_CUBE_MAP]=It(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),Vt[s.TEXTURE_2D_ARRAY]=It(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),Vt[s.TEXTURE_3D]=It(s.TEXTURE_3D,s.TEXTURE_3D,1,1),c.setClear(0,0,0,1),d.setClear(1),g.setClear(0),Wt(s.DEPTH_TEST),d.setFunc(LessEqualDepth),cn(!1),En(CullFaceBack),Wt(s.CULL_FACE),Jt(NoBlending);function Wt(mt){$[mt]!==!0&&(s.enable(mt),$[mt]=!0)}function Kt(mt){$[mt]!==!1&&(s.disable(mt),$[mt]=!1)}function ln(mt,kt){return tt[mt]!==kt?(s.bindFramebuffer(mt,kt),tt[mt]=kt,mt===s.DRAW_FRAMEBUFFER&&(tt[s.FRAMEBUFFER]=kt),mt===s.FRAMEBUFFER&&(tt[s.DRAW_FRAMEBUFFER]=kt),!0):!1}function fn(mt,kt){let Ht=et,Zt=!1;if(mt){Ht=rt.get(kt),Ht===void 0&&(Ht=[],rt.set(kt,Ht));const tn=mt.textures;if(Ht.length!==tn.length||Ht[0]!==s.COLOR_ATTACHMENT0){for(let bn=0,Mn=tn.length;bn<Mn;bn++)Ht[bn]=s.COLOR_ATTACHMENT0+bn;Ht.length=tn.length,Zt=!0}}else Ht[0]!==s.BACK&&(Ht[0]=s.BACK,Zt=!0);Zt&&s.drawBuffers(Ht)}function dn(mt){return st!==mt?(s.useProgram(mt),st=mt,!0):!1}const Lt={[AddEquation]:s.FUNC_ADD,[SubtractEquation]:s.FUNC_SUBTRACT,[ReverseSubtractEquation]:s.FUNC_REVERSE_SUBTRACT};Lt[MinEquation]=s.MIN,Lt[MaxEquation]=s.MAX;const pn={[ZeroFactor]:s.ZERO,[OneFactor]:s.ONE,[SrcColorFactor]:s.SRC_COLOR,[SrcAlphaFactor]:s.SRC_ALPHA,[SrcAlphaSaturateFactor]:s.SRC_ALPHA_SATURATE,[DstColorFactor]:s.DST_COLOR,[DstAlphaFactor]:s.DST_ALPHA,[OneMinusSrcColorFactor]:s.ONE_MINUS_SRC_COLOR,[OneMinusSrcAlphaFactor]:s.ONE_MINUS_SRC_ALPHA,[OneMinusDstColorFactor]:s.ONE_MINUS_DST_COLOR,[OneMinusDstAlphaFactor]:s.ONE_MINUS_DST_ALPHA,[ConstantColorFactor]:s.CONSTANT_COLOR,[OneMinusConstantColorFactor]:s.ONE_MINUS_CONSTANT_COLOR,[ConstantAlphaFactor]:s.CONSTANT_ALPHA,[OneMinusConstantAlphaFactor]:s.ONE_MINUS_CONSTANT_ALPHA};function Jt(mt,kt,Ht,Zt,tn,bn,Mn,In,On,Rn){if(mt===NoBlending){ot===!0&&(Kt(s.BLEND),ot=!1);return}if(ot===!1&&(Wt(s.BLEND),ot=!0),mt!==CustomBlending){if(mt!==at||Rn!==yt){if((lt!==AddEquation||nt!==AddEquation)&&(s.blendEquation(s.FUNC_ADD),lt=AddEquation,nt=AddEquation),Rn)switch(mt){case NormalBlending:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case AdditiveBlending:s.blendFunc(s.ONE,s.ONE);break;case SubtractiveBlending:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case MultiplyBlending:s.blendFuncSeparate(s.ZERO,s.SRC_COLOR,s.ZERO,s.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",mt);break}else switch(mt){case NormalBlending:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case AdditiveBlending:s.blendFunc(s.SRC_ALPHA,s.ONE);break;case SubtractiveBlending:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case MultiplyBlending:s.blendFunc(s.ZERO,s.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",mt);break}_e=null,it=null,ct=null,ht=null,ft.set(0,0,0),pt=0,at=mt,yt=Rn}return}tn=tn||kt,bn=bn||Ht,Mn=Mn||Zt,(kt!==lt||tn!==nt)&&(s.blendEquationSeparate(Lt[kt],Lt[tn]),lt=kt,nt=tn),(Ht!==_e||Zt!==it||bn!==ct||Mn!==ht)&&(s.blendFuncSeparate(pn[Ht],pn[Zt],pn[bn],pn[Mn]),_e=Ht,it=Zt,ct=bn,ht=Mn),(In.equals(ft)===!1||On!==pt)&&(s.blendColor(In.r,In.g,In.b,On),ft.copy(In),pt=On),at=mt,yt=!1}function Qt(mt,kt){mt.side===DoubleSide?Kt(s.CULL_FACE):Wt(s.CULL_FACE);let Ht=mt.side===BackSide;kt&&(Ht=!Ht),cn(Ht),mt.blending===NormalBlending&&mt.transparent===!1?Jt(NoBlending):Jt(mt.blending,mt.blendEquation,mt.blendSrc,mt.blendDst,mt.blendEquationAlpha,mt.blendSrcAlpha,mt.blendDstAlpha,mt.blendColor,mt.blendAlpha,mt.premultipliedAlpha),d.setFunc(mt.depthFunc),d.setTest(mt.depthTest),d.setMask(mt.depthWrite),c.setMask(mt.colorWrite);const Zt=mt.stencilWrite;g.setTest(Zt),Zt&&(g.setMask(mt.stencilWriteMask),g.setFunc(mt.stencilFunc,mt.stencilRef,mt.stencilFuncMask),g.setOp(mt.stencilFail,mt.stencilZFail,mt.stencilZPass)),xt(mt.polygonOffset,mt.polygonOffsetFactor,mt.polygonOffsetUnits),mt.alphaToCoverage===!0?Wt(s.SAMPLE_ALPHA_TO_COVERAGE):Kt(s.SAMPLE_ALPHA_TO_COVERAGE)}function cn(mt){vt!==mt&&(mt?s.frontFace(s.CW):s.frontFace(s.CCW),vt=mt)}function En(mt){mt!==CullFaceNone?(Wt(s.CULL_FACE),mt!==gt&&(mt===CullFaceBack?s.cullFace(s.BACK):mt===CullFaceFront?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):Kt(s.CULL_FACE),gt=mt}function bt(mt){mt!==Ct&&(wt&&s.lineWidth(mt),Ct=mt)}function xt(mt,kt,Ht){mt?(Wt(s.POLYGON_OFFSET_FILL),(Pt!==kt||Tt!==Ht)&&(s.polygonOffset(kt,Ht),Pt=kt,Tt=Ht)):Kt(s.POLYGON_OFFSET_FILL)}function Ft(mt){mt?Wt(s.SCISSOR_TEST):Kt(s.SCISSOR_TEST)}function Gt(mt){mt===void 0&&(mt=s.TEXTURE0+Rt-1),ut!==mt&&(s.activeTexture(mt),ut=mt)}function zt(mt,kt,Ht){Ht===void 0&&(ut===null?Ht=s.TEXTURE0+Rt-1:Ht=ut);let Zt=dt[Ht];Zt===void 0&&(Zt={type:void 0,texture:void 0},dt[Ht]=Zt),(Zt.type!==mt||Zt.texture!==kt)&&(ut!==Ht&&(s.activeTexture(Ht),ut=Ht),s.bindTexture(mt,kt||Vt[mt]),Zt.type=mt,Zt.texture=kt)}function jt(){const mt=dt[ut];mt!==void 0&&mt.type!==void 0&&(s.bindTexture(mt.type,null),mt.type=void 0,mt.texture=void 0)}function on(){try{s.compressedTexImage2D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function Yt(){try{s.compressedTexImage3D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function rn(){try{s.texSubImage2D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function sn(){try{s.texSubImage3D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function qt(){try{s.compressedTexSubImage2D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function $t(){try{s.compressedTexSubImage3D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function mn(){try{s.texStorage2D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function nn(){try{s.texStorage3D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function an(){try{s.texImage2D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function An(){try{s.texImage3D.apply(s,arguments)}catch(mt){console.error("THREE.WebGLState:",mt)}}function Tn(mt){Bt.equals(mt)===!1&&(s.scissor(mt.x,mt.y,mt.z,mt.w),Bt.copy(mt))}function Pn(mt){Xt.equals(mt)===!1&&(s.viewport(mt.x,mt.y,mt.z,mt.w),Xt.copy(mt))}function Cn(mt,kt){let Ht=b.get(kt);Ht===void 0&&(Ht=new WeakMap,b.set(kt,Ht));let Zt=Ht.get(mt);Zt===void 0&&(Zt=s.getUniformBlockIndex(kt,mt.name),Ht.set(mt,Zt))}function wn(mt,kt){const Zt=b.get(kt).get(mt);_.get(kt)!==Zt&&(s.uniformBlockBinding(kt,Zt,mt.__bindingPointIndex),_.set(kt,Zt))}function un(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),$={},ut=null,dt={},tt={},rt=new WeakMap,et=[],st=null,ot=!1,at=null,lt=null,_e=null,it=null,nt=null,ct=null,ht=null,ft=new Color(0,0,0),pt=0,yt=!1,vt=null,gt=null,Ct=null,Pt=null,Tt=null,Bt.set(0,0,s.canvas.width,s.canvas.height),Xt.set(0,0,s.canvas.width,s.canvas.height),c.reset(),d.reset(),g.reset()}return{buffers:{color:c,depth:d,stencil:g},enable:Wt,disable:Kt,bindFramebuffer:ln,drawBuffers:fn,useProgram:dn,setBlending:Jt,setMaterial:Qt,setFlipSided:cn,setCullFace:En,setLineWidth:bt,setPolygonOffset:xt,setScissorTest:Ft,activeTexture:Gt,bindTexture:zt,unbindTexture:jt,compressedTexImage2D:on,compressedTexImage3D:Yt,texImage2D:an,texImage3D:An,updateUBOMapping:Cn,uniformBlockBinding:wn,texStorage2D:mn,texStorage3D:nn,texSubImage2D:rn,texSubImage3D:sn,compressedTexSubImage2D:qt,compressedTexSubImage3D:$t,scissor:Tn,viewport:Pn,reset:un}}function WebGLTextures(s,e,a,o,c,d,g){const _=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,b=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),$=new Vector2,tt=new WeakMap;let rt;const et=new WeakMap;let st=!1;try{st=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function ot(bt,xt){return st?new OffscreenCanvas(bt,xt):createElementNS("canvas")}function at(bt,xt,Ft){let Gt=1;const zt=En(bt);if((zt.width>Ft||zt.height>Ft)&&(Gt=Ft/Math.max(zt.width,zt.height)),Gt<1)if(typeof HTMLImageElement<"u"&&bt instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&bt instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&bt instanceof ImageBitmap||typeof VideoFrame<"u"&&bt instanceof VideoFrame){const jt=Math.floor(Gt*zt.width),on=Math.floor(Gt*zt.height);rt===void 0&&(rt=ot(jt,on));const Yt=xt?ot(jt,on):rt;return Yt.width=jt,Yt.height=on,Yt.getContext("2d").drawImage(bt,0,0,jt,on),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+zt.width+"x"+zt.height+") to ("+jt+"x"+on+")."),Yt}else return"data"in bt&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+zt.width+"x"+zt.height+")."),bt;return bt}function lt(bt){return bt.generateMipmaps&&bt.minFilter!==NearestFilter&&bt.minFilter!==LinearFilter}function _e(bt){s.generateMipmap(bt)}function it(bt,xt,Ft,Gt,zt=!1){if(bt!==null){if(s[bt]!==void 0)return s[bt];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+bt+"'")}let jt=xt;if(xt===s.RED&&(Ft===s.FLOAT&&(jt=s.R32F),Ft===s.HALF_FLOAT&&(jt=s.R16F),Ft===s.UNSIGNED_BYTE&&(jt=s.R8)),xt===s.RED_INTEGER&&(Ft===s.UNSIGNED_BYTE&&(jt=s.R8UI),Ft===s.UNSIGNED_SHORT&&(jt=s.R16UI),Ft===s.UNSIGNED_INT&&(jt=s.R32UI),Ft===s.BYTE&&(jt=s.R8I),Ft===s.SHORT&&(jt=s.R16I),Ft===s.INT&&(jt=s.R32I)),xt===s.RG&&(Ft===s.FLOAT&&(jt=s.RG32F),Ft===s.HALF_FLOAT&&(jt=s.RG16F),Ft===s.UNSIGNED_BYTE&&(jt=s.RG8)),xt===s.RG_INTEGER&&(Ft===s.UNSIGNED_BYTE&&(jt=s.RG8UI),Ft===s.UNSIGNED_SHORT&&(jt=s.RG16UI),Ft===s.UNSIGNED_INT&&(jt=s.RG32UI),Ft===s.BYTE&&(jt=s.RG8I),Ft===s.SHORT&&(jt=s.RG16I),Ft===s.INT&&(jt=s.RG32I)),xt===s.RGB&&Ft===s.UNSIGNED_INT_5_9_9_9_REV&&(jt=s.RGB9_E5),xt===s.RGBA){const on=zt?LinearTransfer:ColorManagement.getTransfer(Gt);Ft===s.FLOAT&&(jt=s.RGBA32F),Ft===s.HALF_FLOAT&&(jt=s.RGBA16F),Ft===s.UNSIGNED_BYTE&&(jt=on===SRGBTransfer?s.SRGB8_ALPHA8:s.RGBA8),Ft===s.UNSIGNED_SHORT_4_4_4_4&&(jt=s.RGBA4),Ft===s.UNSIGNED_SHORT_5_5_5_1&&(jt=s.RGB5_A1)}return(jt===s.R16F||jt===s.R32F||jt===s.RG16F||jt===s.RG32F||jt===s.RGBA16F||jt===s.RGBA32F)&&e.get("EXT_color_buffer_float"),jt}function nt(bt,xt){return lt(bt)===!0||bt.isFramebufferTexture&&bt.minFilter!==NearestFilter&&bt.minFilter!==LinearFilter?Math.log2(Math.max(xt.width,xt.height))+1:bt.mipmaps!==void 0&&bt.mipmaps.length>0?bt.mipmaps.length:bt.isCompressedTexture&&Array.isArray(bt.image)?xt.mipmaps.length:1}function ct(bt){const xt=bt.target;xt.removeEventListener("dispose",ct),ft(xt),xt.isVideoTexture&&tt.delete(xt)}function ht(bt){const xt=bt.target;xt.removeEventListener("dispose",ht),yt(xt)}function ft(bt){const xt=o.get(bt);if(xt.__webglInit===void 0)return;const Ft=bt.source,Gt=et.get(Ft);if(Gt){const zt=Gt[xt.__cacheKey];zt.usedTimes--,zt.usedTimes===0&&pt(bt),Object.keys(Gt).length===0&&et.delete(Ft)}o.remove(bt)}function pt(bt){const xt=o.get(bt);s.deleteTexture(xt.__webglTexture);const Ft=bt.source,Gt=et.get(Ft);delete Gt[xt.__cacheKey],g.memory.textures--}function yt(bt){const xt=o.get(bt);if(bt.depthTexture&&bt.depthTexture.dispose(),bt.isWebGLCubeRenderTarget)for(let Gt=0;Gt<6;Gt++){if(Array.isArray(xt.__webglFramebuffer[Gt]))for(let zt=0;zt<xt.__webglFramebuffer[Gt].length;zt++)s.deleteFramebuffer(xt.__webglFramebuffer[Gt][zt]);else s.deleteFramebuffer(xt.__webglFramebuffer[Gt]);xt.__webglDepthbuffer&&s.deleteRenderbuffer(xt.__webglDepthbuffer[Gt])}else{if(Array.isArray(xt.__webglFramebuffer))for(let Gt=0;Gt<xt.__webglFramebuffer.length;Gt++)s.deleteFramebuffer(xt.__webglFramebuffer[Gt]);else s.deleteFramebuffer(xt.__webglFramebuffer);if(xt.__webglDepthbuffer&&s.deleteRenderbuffer(xt.__webglDepthbuffer),xt.__webglMultisampledFramebuffer&&s.deleteFramebuffer(xt.__webglMultisampledFramebuffer),xt.__webglColorRenderbuffer)for(let Gt=0;Gt<xt.__webglColorRenderbuffer.length;Gt++)xt.__webglColorRenderbuffer[Gt]&&s.deleteRenderbuffer(xt.__webglColorRenderbuffer[Gt]);xt.__webglDepthRenderbuffer&&s.deleteRenderbuffer(xt.__webglDepthRenderbuffer)}const Ft=bt.textures;for(let Gt=0,zt=Ft.length;Gt<zt;Gt++){const jt=o.get(Ft[Gt]);jt.__webglTexture&&(s.deleteTexture(jt.__webglTexture),g.memory.textures--),o.remove(Ft[Gt])}o.remove(bt)}let vt=0;function gt(){vt=0}function Ct(){const bt=vt;return bt>=c.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+bt+" texture units while this GPU supports only "+c.maxTextures),vt+=1,bt}function Pt(bt){const xt=[];return xt.push(bt.wrapS),xt.push(bt.wrapT),xt.push(bt.wrapR||0),xt.push(bt.magFilter),xt.push(bt.minFilter),xt.push(bt.anisotropy),xt.push(bt.internalFormat),xt.push(bt.format),xt.push(bt.type),xt.push(bt.generateMipmaps),xt.push(bt.premultiplyAlpha),xt.push(bt.flipY),xt.push(bt.unpackAlignment),xt.push(bt.colorSpace),xt.join()}function Tt(bt,xt){const Ft=o.get(bt);if(bt.isVideoTexture&&Qt(bt),bt.isRenderTargetTexture===!1&&bt.version>0&&Ft.__version!==bt.version){const Gt=bt.image;if(Gt===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(Gt.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{Bt(Ft,bt,xt);return}}a.bindTexture(s.TEXTURE_2D,Ft.__webglTexture,s.TEXTURE0+xt)}function Rt(bt,xt){const Ft=o.get(bt);if(bt.version>0&&Ft.__version!==bt.version){Bt(Ft,bt,xt);return}a.bindTexture(s.TEXTURE_2D_ARRAY,Ft.__webglTexture,s.TEXTURE0+xt)}function wt(bt,xt){const Ft=o.get(bt);if(bt.version>0&&Ft.__version!==bt.version){Bt(Ft,bt,xt);return}a.bindTexture(s.TEXTURE_3D,Ft.__webglTexture,s.TEXTURE0+xt)}function _t(bt,xt){const Ft=o.get(bt);if(bt.version>0&&Ft.__version!==bt.version){Xt(Ft,bt,xt);return}a.bindTexture(s.TEXTURE_CUBE_MAP,Ft.__webglTexture,s.TEXTURE0+xt)}const St={[RepeatWrapping]:s.REPEAT,[ClampToEdgeWrapping]:s.CLAMP_TO_EDGE,[MirroredRepeatWrapping]:s.MIRRORED_REPEAT},ut={[NearestFilter]:s.NEAREST,[NearestMipmapNearestFilter]:s.NEAREST_MIPMAP_NEAREST,[NearestMipmapLinearFilter]:s.NEAREST_MIPMAP_LINEAR,[LinearFilter]:s.LINEAR,[LinearMipmapNearestFilter]:s.LINEAR_MIPMAP_NEAREST,[LinearMipmapLinearFilter]:s.LINEAR_MIPMAP_LINEAR},dt={[NeverCompare]:s.NEVER,[AlwaysCompare]:s.ALWAYS,[LessCompare]:s.LESS,[LessEqualCompare]:s.LEQUAL,[EqualCompare]:s.EQUAL,[GreaterEqualCompare]:s.GEQUAL,[GreaterCompare]:s.GREATER,[NotEqualCompare]:s.NOTEQUAL};function Mt(bt,xt){if(xt.type===FloatType&&e.has("OES_texture_float_linear")===!1&&(xt.magFilter===LinearFilter||xt.magFilter===LinearMipmapNearestFilter||xt.magFilter===NearestMipmapLinearFilter||xt.magFilter===LinearMipmapLinearFilter||xt.minFilter===LinearFilter||xt.minFilter===LinearMipmapNearestFilter||xt.minFilter===NearestMipmapLinearFilter||xt.minFilter===LinearMipmapLinearFilter)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(bt,s.TEXTURE_WRAP_S,St[xt.wrapS]),s.texParameteri(bt,s.TEXTURE_WRAP_T,St[xt.wrapT]),(bt===s.TEXTURE_3D||bt===s.TEXTURE_2D_ARRAY)&&s.texParameteri(bt,s.TEXTURE_WRAP_R,St[xt.wrapR]),s.texParameteri(bt,s.TEXTURE_MAG_FILTER,ut[xt.magFilter]),s.texParameteri(bt,s.TEXTURE_MIN_FILTER,ut[xt.minFilter]),xt.compareFunction&&(s.texParameteri(bt,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(bt,s.TEXTURE_COMPARE_FUNC,dt[xt.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(xt.magFilter===NearestFilter||xt.minFilter!==NearestMipmapLinearFilter&&xt.minFilter!==LinearMipmapLinearFilter||xt.type===FloatType&&e.has("OES_texture_float_linear")===!1)return;if(xt.anisotropy>1||o.get(xt).__currentAnisotropy){const Ft=e.get("EXT_texture_filter_anisotropic");s.texParameterf(bt,Ft.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(xt.anisotropy,c.getMaxAnisotropy())),o.get(xt).__currentAnisotropy=xt.anisotropy}}}function At(bt,xt){let Ft=!1;bt.__webglInit===void 0&&(bt.__webglInit=!0,xt.addEventListener("dispose",ct));const Gt=xt.source;let zt=et.get(Gt);zt===void 0&&(zt={},et.set(Gt,zt));const jt=Pt(xt);if(jt!==bt.__cacheKey){zt[jt]===void 0&&(zt[jt]={texture:s.createTexture(),usedTimes:0},g.memory.textures++,Ft=!0),zt[jt].usedTimes++;const on=zt[bt.__cacheKey];on!==void 0&&(zt[bt.__cacheKey].usedTimes--,on.usedTimes===0&&pt(xt)),bt.__cacheKey=jt,bt.__webglTexture=zt[jt].texture}return Ft}function Bt(bt,xt,Ft){let Gt=s.TEXTURE_2D;(xt.isDataArrayTexture||xt.isCompressedArrayTexture)&&(Gt=s.TEXTURE_2D_ARRAY),xt.isData3DTexture&&(Gt=s.TEXTURE_3D);const zt=At(bt,xt),jt=xt.source;a.bindTexture(Gt,bt.__webglTexture,s.TEXTURE0+Ft);const on=o.get(jt);if(jt.version!==on.__version||zt===!0){a.activeTexture(s.TEXTURE0+Ft);const Yt=ColorManagement.getPrimaries(ColorManagement.workingColorSpace),rn=xt.colorSpace===NoColorSpace?null:ColorManagement.getPrimaries(xt.colorSpace),sn=xt.colorSpace===NoColorSpace||Yt===rn?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,xt.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,xt.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,xt.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,sn);let qt=at(xt.image,!1,c.maxTextureSize);qt=cn(xt,qt);const $t=d.convert(xt.format,xt.colorSpace),mn=d.convert(xt.type);let nn=it(xt.internalFormat,$t,mn,xt.colorSpace,xt.isVideoTexture);Mt(Gt,xt);let an;const An=xt.mipmaps,Tn=xt.isVideoTexture!==!0&&nn!==RGB_ETC1_Format,Pn=on.__version===void 0||zt===!0,Cn=jt.dataReady,wn=nt(xt,qt);if(xt.isDepthTexture)nn=s.DEPTH_COMPONENT16,xt.type===FloatType?nn=s.DEPTH_COMPONENT32F:xt.type===UnsignedIntType?nn=s.DEPTH_COMPONENT24:xt.type===UnsignedInt248Type&&(nn=s.DEPTH24_STENCIL8),Pn&&(Tn?a.texStorage2D(s.TEXTURE_2D,1,nn,qt.width,qt.height):a.texImage2D(s.TEXTURE_2D,0,nn,qt.width,qt.height,0,$t,mn,null));else if(xt.isDataTexture)if(An.length>0){Tn&&Pn&&a.texStorage2D(s.TEXTURE_2D,wn,nn,An[0].width,An[0].height);for(let un=0,mt=An.length;un<mt;un++)an=An[un],Tn?Cn&&a.texSubImage2D(s.TEXTURE_2D,un,0,0,an.width,an.height,$t,mn,an.data):a.texImage2D(s.TEXTURE_2D,un,nn,an.width,an.height,0,$t,mn,an.data);xt.generateMipmaps=!1}else Tn?(Pn&&a.texStorage2D(s.TEXTURE_2D,wn,nn,qt.width,qt.height),Cn&&a.texSubImage2D(s.TEXTURE_2D,0,0,0,qt.width,qt.height,$t,mn,qt.data)):a.texImage2D(s.TEXTURE_2D,0,nn,qt.width,qt.height,0,$t,mn,qt.data);else if(xt.isCompressedTexture)if(xt.isCompressedArrayTexture){Tn&&Pn&&a.texStorage3D(s.TEXTURE_2D_ARRAY,wn,nn,An[0].width,An[0].height,qt.depth);for(let un=0,mt=An.length;un<mt;un++)an=An[un],xt.format!==RGBAFormat?$t!==null?Tn?Cn&&a.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,un,0,0,0,an.width,an.height,qt.depth,$t,an.data,0,0):a.compressedTexImage3D(s.TEXTURE_2D_ARRAY,un,nn,an.width,an.height,qt.depth,0,an.data,0,0):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Tn?Cn&&a.texSubImage3D(s.TEXTURE_2D_ARRAY,un,0,0,0,an.width,an.height,qt.depth,$t,mn,an.data):a.texImage3D(s.TEXTURE_2D_ARRAY,un,nn,an.width,an.height,qt.depth,0,$t,mn,an.data)}else{Tn&&Pn&&a.texStorage2D(s.TEXTURE_2D,wn,nn,An[0].width,An[0].height);for(let un=0,mt=An.length;un<mt;un++)an=An[un],xt.format!==RGBAFormat?$t!==null?Tn?Cn&&a.compressedTexSubImage2D(s.TEXTURE_2D,un,0,0,an.width,an.height,$t,an.data):a.compressedTexImage2D(s.TEXTURE_2D,un,nn,an.width,an.height,0,an.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Tn?Cn&&a.texSubImage2D(s.TEXTURE_2D,un,0,0,an.width,an.height,$t,mn,an.data):a.texImage2D(s.TEXTURE_2D,un,nn,an.width,an.height,0,$t,mn,an.data)}else if(xt.isDataArrayTexture)Tn?(Pn&&a.texStorage3D(s.TEXTURE_2D_ARRAY,wn,nn,qt.width,qt.height,qt.depth),Cn&&a.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,qt.width,qt.height,qt.depth,$t,mn,qt.data)):a.texImage3D(s.TEXTURE_2D_ARRAY,0,nn,qt.width,qt.height,qt.depth,0,$t,mn,qt.data);else if(xt.isData3DTexture)Tn?(Pn&&a.texStorage3D(s.TEXTURE_3D,wn,nn,qt.width,qt.height,qt.depth),Cn&&a.texSubImage3D(s.TEXTURE_3D,0,0,0,0,qt.width,qt.height,qt.depth,$t,mn,qt.data)):a.texImage3D(s.TEXTURE_3D,0,nn,qt.width,qt.height,qt.depth,0,$t,mn,qt.data);else if(xt.isFramebufferTexture){if(Pn)if(Tn)a.texStorage2D(s.TEXTURE_2D,wn,nn,qt.width,qt.height);else{let un=qt.width,mt=qt.height;for(let kt=0;kt<wn;kt++)a.texImage2D(s.TEXTURE_2D,kt,nn,un,mt,0,$t,mn,null),un>>=1,mt>>=1}}else if(An.length>0){if(Tn&&Pn){const un=En(An[0]);a.texStorage2D(s.TEXTURE_2D,wn,nn,un.width,un.height)}for(let un=0,mt=An.length;un<mt;un++)an=An[un],Tn?Cn&&a.texSubImage2D(s.TEXTURE_2D,un,0,0,$t,mn,an):a.texImage2D(s.TEXTURE_2D,un,nn,$t,mn,an);xt.generateMipmaps=!1}else if(Tn){if(Pn){const un=En(qt);a.texStorage2D(s.TEXTURE_2D,wn,nn,un.width,un.height)}Cn&&a.texSubImage2D(s.TEXTURE_2D,0,0,0,$t,mn,qt)}else a.texImage2D(s.TEXTURE_2D,0,nn,$t,mn,qt);lt(xt)&&_e(Gt),on.__version=jt.version,xt.onUpdate&&xt.onUpdate(xt)}bt.__version=xt.version}function Xt(bt,xt,Ft){if(xt.image.length!==6)return;const Gt=At(bt,xt),zt=xt.source;a.bindTexture(s.TEXTURE_CUBE_MAP,bt.__webglTexture,s.TEXTURE0+Ft);const jt=o.get(zt);if(zt.version!==jt.__version||Gt===!0){a.activeTexture(s.TEXTURE0+Ft);const on=ColorManagement.getPrimaries(ColorManagement.workingColorSpace),Yt=xt.colorSpace===NoColorSpace?null:ColorManagement.getPrimaries(xt.colorSpace),rn=xt.colorSpace===NoColorSpace||on===Yt?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,xt.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,xt.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,xt.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,rn);const sn=xt.isCompressedTexture||xt.image[0].isCompressedTexture,qt=xt.image[0]&&xt.image[0].isDataTexture,$t=[];for(let mt=0;mt<6;mt++)!sn&&!qt?$t[mt]=at(xt.image[mt],!0,c.maxCubemapSize):$t[mt]=qt?xt.image[mt].image:xt.image[mt],$t[mt]=cn(xt,$t[mt]);const mn=$t[0],nn=d.convert(xt.format,xt.colorSpace),an=d.convert(xt.type),An=it(xt.internalFormat,nn,an,xt.colorSpace),Tn=xt.isVideoTexture!==!0,Pn=jt.__version===void 0||Gt===!0,Cn=zt.dataReady;let wn=nt(xt,mn);Mt(s.TEXTURE_CUBE_MAP,xt);let un;if(sn){Tn&&Pn&&a.texStorage2D(s.TEXTURE_CUBE_MAP,wn,An,mn.width,mn.height);for(let mt=0;mt<6;mt++){un=$t[mt].mipmaps;for(let kt=0;kt<un.length;kt++){const Ht=un[kt];xt.format!==RGBAFormat?nn!==null?Tn?Cn&&a.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,kt,0,0,Ht.width,Ht.height,nn,Ht.data):a.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,kt,An,Ht.width,Ht.height,0,Ht.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Tn?Cn&&a.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,kt,0,0,Ht.width,Ht.height,nn,an,Ht.data):a.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,kt,An,Ht.width,Ht.height,0,nn,an,Ht.data)}}}else{if(un=xt.mipmaps,Tn&&Pn){un.length>0&&wn++;const mt=En($t[0]);a.texStorage2D(s.TEXTURE_CUBE_MAP,wn,An,mt.width,mt.height)}for(let mt=0;mt<6;mt++)if(qt){Tn?Cn&&a.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,0,0,0,$t[mt].width,$t[mt].height,nn,an,$t[mt].data):a.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,0,An,$t[mt].width,$t[mt].height,0,nn,an,$t[mt].data);for(let kt=0;kt<un.length;kt++){const Zt=un[kt].image[mt].image;Tn?Cn&&a.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,kt+1,0,0,Zt.width,Zt.height,nn,an,Zt.data):a.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,kt+1,An,Zt.width,Zt.height,0,nn,an,Zt.data)}}else{Tn?Cn&&a.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,0,0,0,nn,an,$t[mt]):a.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,0,An,nn,an,$t[mt]);for(let kt=0;kt<un.length;kt++){const Ht=un[kt];Tn?Cn&&a.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,kt+1,0,0,nn,an,Ht.image[mt]):a.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+mt,kt+1,An,nn,an,Ht.image[mt])}}}lt(xt)&&_e(s.TEXTURE_CUBE_MAP),jt.__version=zt.version,xt.onUpdate&&xt.onUpdate(xt)}bt.__version=xt.version}function It(bt,xt,Ft,Gt,zt,jt){const on=d.convert(Ft.format,Ft.colorSpace),Yt=d.convert(Ft.type),rn=it(Ft.internalFormat,on,Yt,Ft.colorSpace);if(!o.get(xt).__hasExternalTextures){const qt=Math.max(1,xt.width>>jt),$t=Math.max(1,xt.height>>jt);zt===s.TEXTURE_3D||zt===s.TEXTURE_2D_ARRAY?a.texImage3D(zt,jt,rn,qt,$t,xt.depth,0,on,Yt,null):a.texImage2D(zt,jt,rn,qt,$t,0,on,Yt,null)}a.bindFramebuffer(s.FRAMEBUFFER,bt),Jt(xt)?_.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,Gt,zt,o.get(Ft).__webglTexture,0,pn(xt)):(zt===s.TEXTURE_2D||zt>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&zt<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,Gt,zt,o.get(Ft).__webglTexture,jt),a.bindFramebuffer(s.FRAMEBUFFER,null)}function Vt(bt,xt,Ft){if(s.bindRenderbuffer(s.RENDERBUFFER,bt),xt.depthBuffer&&!xt.stencilBuffer){let Gt=s.DEPTH_COMPONENT24;if(Ft||Jt(xt)){const zt=xt.depthTexture;zt&&zt.isDepthTexture&&(zt.type===FloatType?Gt=s.DEPTH_COMPONENT32F:zt.type===UnsignedIntType&&(Gt=s.DEPTH_COMPONENT24));const jt=pn(xt);Jt(xt)?_.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,jt,Gt,xt.width,xt.height):s.renderbufferStorageMultisample(s.RENDERBUFFER,jt,Gt,xt.width,xt.height)}else s.renderbufferStorage(s.RENDERBUFFER,Gt,xt.width,xt.height);s.framebufferRenderbuffer(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.RENDERBUFFER,bt)}else if(xt.depthBuffer&&xt.stencilBuffer){const Gt=pn(xt);Ft&&Jt(xt)===!1?s.renderbufferStorageMultisample(s.RENDERBUFFER,Gt,s.DEPTH24_STENCIL8,xt.width,xt.height):Jt(xt)?_.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,Gt,s.DEPTH24_STENCIL8,xt.width,xt.height):s.renderbufferStorage(s.RENDERBUFFER,s.DEPTH_STENCIL,xt.width,xt.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.RENDERBUFFER,bt)}else{const Gt=xt.textures;for(let zt=0;zt<Gt.length;zt++){const jt=Gt[zt],on=d.convert(jt.format,jt.colorSpace),Yt=d.convert(jt.type),rn=it(jt.internalFormat,on,Yt,jt.colorSpace),sn=pn(xt);Ft&&Jt(xt)===!1?s.renderbufferStorageMultisample(s.RENDERBUFFER,sn,rn,xt.width,xt.height):Jt(xt)?_.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,sn,rn,xt.width,xt.height):s.renderbufferStorage(s.RENDERBUFFER,rn,xt.width,xt.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function Wt(bt,xt){if(xt&&xt.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(a.bindFramebuffer(s.FRAMEBUFFER,bt),!(xt.depthTexture&&xt.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!o.get(xt.depthTexture).__webglTexture||xt.depthTexture.image.width!==xt.width||xt.depthTexture.image.height!==xt.height)&&(xt.depthTexture.image.width=xt.width,xt.depthTexture.image.height=xt.height,xt.depthTexture.needsUpdate=!0),Tt(xt.depthTexture,0);const Gt=o.get(xt.depthTexture).__webglTexture,zt=pn(xt);if(xt.depthTexture.format===DepthFormat)Jt(xt)?_.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Gt,0,zt):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Gt,0);else if(xt.depthTexture.format===DepthStencilFormat)Jt(xt)?_.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Gt,0,zt):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Gt,0);else throw new Error("Unknown depthTexture format")}function Kt(bt){const xt=o.get(bt),Ft=bt.isWebGLCubeRenderTarget===!0;if(bt.depthTexture&&!xt.__autoAllocateDepthBuffer){if(Ft)throw new Error("target.depthTexture not supported in Cube render targets");Wt(xt.__webglFramebuffer,bt)}else if(Ft){xt.__webglDepthbuffer=[];for(let Gt=0;Gt<6;Gt++)a.bindFramebuffer(s.FRAMEBUFFER,xt.__webglFramebuffer[Gt]),xt.__webglDepthbuffer[Gt]=s.createRenderbuffer(),Vt(xt.__webglDepthbuffer[Gt],bt,!1)}else a.bindFramebuffer(s.FRAMEBUFFER,xt.__webglFramebuffer),xt.__webglDepthbuffer=s.createRenderbuffer(),Vt(xt.__webglDepthbuffer,bt,!1);a.bindFramebuffer(s.FRAMEBUFFER,null)}function ln(bt,xt,Ft){const Gt=o.get(bt);xt!==void 0&&It(Gt.__webglFramebuffer,bt,bt.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),Ft!==void 0&&Kt(bt)}function fn(bt){const xt=bt.texture,Ft=o.get(bt),Gt=o.get(xt);bt.addEventListener("dispose",ht);const zt=bt.textures,jt=bt.isWebGLCubeRenderTarget===!0,on=zt.length>1;if(on||(Gt.__webglTexture===void 0&&(Gt.__webglTexture=s.createTexture()),Gt.__version=xt.version,g.memory.textures++),jt){Ft.__webglFramebuffer=[];for(let Yt=0;Yt<6;Yt++)if(xt.mipmaps&&xt.mipmaps.length>0){Ft.__webglFramebuffer[Yt]=[];for(let rn=0;rn<xt.mipmaps.length;rn++)Ft.__webglFramebuffer[Yt][rn]=s.createFramebuffer()}else Ft.__webglFramebuffer[Yt]=s.createFramebuffer()}else{if(xt.mipmaps&&xt.mipmaps.length>0){Ft.__webglFramebuffer=[];for(let Yt=0;Yt<xt.mipmaps.length;Yt++)Ft.__webglFramebuffer[Yt]=s.createFramebuffer()}else Ft.__webglFramebuffer=s.createFramebuffer();if(on)for(let Yt=0,rn=zt.length;Yt<rn;Yt++){const sn=o.get(zt[Yt]);sn.__webglTexture===void 0&&(sn.__webglTexture=s.createTexture(),g.memory.textures++)}if(bt.samples>0&&Jt(bt)===!1){Ft.__webglMultisampledFramebuffer=s.createFramebuffer(),Ft.__webglColorRenderbuffer=[],a.bindFramebuffer(s.FRAMEBUFFER,Ft.__webglMultisampledFramebuffer);for(let Yt=0;Yt<zt.length;Yt++){const rn=zt[Yt];Ft.__webglColorRenderbuffer[Yt]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,Ft.__webglColorRenderbuffer[Yt]);const sn=d.convert(rn.format,rn.colorSpace),qt=d.convert(rn.type),$t=it(rn.internalFormat,sn,qt,rn.colorSpace,bt.isXRRenderTarget===!0),mn=pn(bt);s.renderbufferStorageMultisample(s.RENDERBUFFER,mn,$t,bt.width,bt.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Yt,s.RENDERBUFFER,Ft.__webglColorRenderbuffer[Yt])}s.bindRenderbuffer(s.RENDERBUFFER,null),bt.depthBuffer&&(Ft.__webglDepthRenderbuffer=s.createRenderbuffer(),Vt(Ft.__webglDepthRenderbuffer,bt,!0)),a.bindFramebuffer(s.FRAMEBUFFER,null)}}if(jt){a.bindTexture(s.TEXTURE_CUBE_MAP,Gt.__webglTexture),Mt(s.TEXTURE_CUBE_MAP,xt);for(let Yt=0;Yt<6;Yt++)if(xt.mipmaps&&xt.mipmaps.length>0)for(let rn=0;rn<xt.mipmaps.length;rn++)It(Ft.__webglFramebuffer[Yt][rn],bt,xt,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+Yt,rn);else It(Ft.__webglFramebuffer[Yt],bt,xt,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+Yt,0);lt(xt)&&_e(s.TEXTURE_CUBE_MAP),a.unbindTexture()}else if(on){for(let Yt=0,rn=zt.length;Yt<rn;Yt++){const sn=zt[Yt],qt=o.get(sn);a.bindTexture(s.TEXTURE_2D,qt.__webglTexture),Mt(s.TEXTURE_2D,sn),It(Ft.__webglFramebuffer,bt,sn,s.COLOR_ATTACHMENT0+Yt,s.TEXTURE_2D,0),lt(sn)&&_e(s.TEXTURE_2D)}a.unbindTexture()}else{let Yt=s.TEXTURE_2D;if((bt.isWebGL3DRenderTarget||bt.isWebGLArrayRenderTarget)&&(Yt=bt.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),a.bindTexture(Yt,Gt.__webglTexture),Mt(Yt,xt),xt.mipmaps&&xt.mipmaps.length>0)for(let rn=0;rn<xt.mipmaps.length;rn++)It(Ft.__webglFramebuffer[rn],bt,xt,s.COLOR_ATTACHMENT0,Yt,rn);else It(Ft.__webglFramebuffer,bt,xt,s.COLOR_ATTACHMENT0,Yt,0);lt(xt)&&_e(Yt),a.unbindTexture()}bt.depthBuffer&&Kt(bt)}function dn(bt){const xt=bt.textures;for(let Ft=0,Gt=xt.length;Ft<Gt;Ft++){const zt=xt[Ft];if(lt(zt)){const jt=bt.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:s.TEXTURE_2D,on=o.get(zt).__webglTexture;a.bindTexture(jt,on),_e(jt),a.unbindTexture()}}}function Lt(bt){if(bt.samples>0&&Jt(bt)===!1){const xt=bt.textures,Ft=bt.width,Gt=bt.height;let zt=s.COLOR_BUFFER_BIT;const jt=[],on=bt.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Yt=o.get(bt),rn=xt.length>1;if(rn)for(let sn=0;sn<xt.length;sn++)a.bindFramebuffer(s.FRAMEBUFFER,Yt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+sn,s.RENDERBUFFER,null),a.bindFramebuffer(s.FRAMEBUFFER,Yt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+sn,s.TEXTURE_2D,null,0);a.bindFramebuffer(s.READ_FRAMEBUFFER,Yt.__webglMultisampledFramebuffer),a.bindFramebuffer(s.DRAW_FRAMEBUFFER,Yt.__webglFramebuffer);for(let sn=0;sn<xt.length;sn++){jt.push(s.COLOR_ATTACHMENT0+sn),bt.depthBuffer&&jt.push(on);const qt=Yt.__ignoreDepthValues!==void 0?Yt.__ignoreDepthValues:!1;if(qt===!1&&(bt.depthBuffer&&(zt|=s.DEPTH_BUFFER_BIT),bt.stencilBuffer&&Yt.__isTransmissionRenderTarget!==!0&&(zt|=s.STENCIL_BUFFER_BIT)),rn&&s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,Yt.__webglColorRenderbuffer[sn]),qt===!0&&(s.invalidateFramebuffer(s.READ_FRAMEBUFFER,[on]),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[on])),rn){const $t=o.get(xt[sn]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,$t,0)}s.blitFramebuffer(0,0,Ft,Gt,0,0,Ft,Gt,zt,s.NEAREST),b&&s.invalidateFramebuffer(s.READ_FRAMEBUFFER,jt)}if(a.bindFramebuffer(s.READ_FRAMEBUFFER,null),a.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),rn)for(let sn=0;sn<xt.length;sn++){a.bindFramebuffer(s.FRAMEBUFFER,Yt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+sn,s.RENDERBUFFER,Yt.__webglColorRenderbuffer[sn]);const qt=o.get(xt[sn]).__webglTexture;a.bindFramebuffer(s.FRAMEBUFFER,Yt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+sn,s.TEXTURE_2D,qt,0)}a.bindFramebuffer(s.DRAW_FRAMEBUFFER,Yt.__webglMultisampledFramebuffer)}}function pn(bt){return Math.min(c.maxSamples,bt.samples)}function Jt(bt){const xt=o.get(bt);return bt.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&xt.__useRenderToTexture!==!1}function Qt(bt){const xt=g.render.frame;tt.get(bt)!==xt&&(tt.set(bt,xt),bt.update())}function cn(bt,xt){const Ft=bt.colorSpace,Gt=bt.format,zt=bt.type;return bt.isCompressedTexture===!0||bt.isVideoTexture===!0||Ft!==LinearSRGBColorSpace&&Ft!==NoColorSpace&&(ColorManagement.getTransfer(Ft)===SRGBTransfer?(Gt!==RGBAFormat||zt!==UnsignedByteType)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",Ft)),xt}function En(bt){return typeof HTMLImageElement<"u"&&bt instanceof HTMLImageElement?($.width=bt.naturalWidth||bt.width,$.height=bt.naturalHeight||bt.height):typeof VideoFrame<"u"&&bt instanceof VideoFrame?($.width=bt.displayWidth,$.height=bt.displayHeight):($.width=bt.width,$.height=bt.height),$}this.allocateTextureUnit=Ct,this.resetTextureUnits=gt,this.setTexture2D=Tt,this.setTexture2DArray=Rt,this.setTexture3D=wt,this.setTextureCube=_t,this.rebindTextures=ln,this.setupRenderTarget=fn,this.updateRenderTargetMipmap=dn,this.updateMultisampleRenderTarget=Lt,this.setupDepthRenderbuffer=Kt,this.setupFrameBufferTexture=It,this.useMultisampledRTT=Jt}function WebGLUtils(s,e){function a(o,c=NoColorSpace){let d;const g=ColorManagement.getTransfer(c);if(o===UnsignedByteType)return s.UNSIGNED_BYTE;if(o===UnsignedShort4444Type)return s.UNSIGNED_SHORT_4_4_4_4;if(o===UnsignedShort5551Type)return s.UNSIGNED_SHORT_5_5_5_1;if(o===UnsignedInt5999Type)return s.UNSIGNED_INT_5_9_9_9_REV;if(o===ByteType)return s.BYTE;if(o===ShortType)return s.SHORT;if(o===UnsignedShortType)return s.UNSIGNED_SHORT;if(o===IntType)return s.INT;if(o===UnsignedIntType)return s.UNSIGNED_INT;if(o===FloatType)return s.FLOAT;if(o===HalfFloatType)return s.HALF_FLOAT;if(o===AlphaFormat)return s.ALPHA;if(o===RGBFormat)return s.RGB;if(o===RGBAFormat)return s.RGBA;if(o===LuminanceFormat)return s.LUMINANCE;if(o===LuminanceAlphaFormat)return s.LUMINANCE_ALPHA;if(o===DepthFormat)return s.DEPTH_COMPONENT;if(o===DepthStencilFormat)return s.DEPTH_STENCIL;if(o===RedFormat)return s.RED;if(o===RedIntegerFormat)return s.RED_INTEGER;if(o===RGFormat)return s.RG;if(o===RGIntegerFormat)return s.RG_INTEGER;if(o===RGBAIntegerFormat)return s.RGBA_INTEGER;if(o===RGB_S3TC_DXT1_Format||o===RGBA_S3TC_DXT1_Format||o===RGBA_S3TC_DXT3_Format||o===RGBA_S3TC_DXT5_Format)if(g===SRGBTransfer)if(d=e.get("WEBGL_compressed_texture_s3tc_srgb"),d!==null){if(o===RGB_S3TC_DXT1_Format)return d.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(o===RGBA_S3TC_DXT1_Format)return d.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(o===RGBA_S3TC_DXT3_Format)return d.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(o===RGBA_S3TC_DXT5_Format)return d.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(d=e.get("WEBGL_compressed_texture_s3tc"),d!==null){if(o===RGB_S3TC_DXT1_Format)return d.COMPRESSED_RGB_S3TC_DXT1_EXT;if(o===RGBA_S3TC_DXT1_Format)return d.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(o===RGBA_S3TC_DXT3_Format)return d.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(o===RGBA_S3TC_DXT5_Format)return d.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(o===RGB_PVRTC_4BPPV1_Format||o===RGB_PVRTC_2BPPV1_Format||o===RGBA_PVRTC_4BPPV1_Format||o===RGBA_PVRTC_2BPPV1_Format)if(d=e.get("WEBGL_compressed_texture_pvrtc"),d!==null){if(o===RGB_PVRTC_4BPPV1_Format)return d.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(o===RGB_PVRTC_2BPPV1_Format)return d.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(o===RGBA_PVRTC_4BPPV1_Format)return d.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(o===RGBA_PVRTC_2BPPV1_Format)return d.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(o===RGB_ETC1_Format)return d=e.get("WEBGL_compressed_texture_etc1"),d!==null?d.COMPRESSED_RGB_ETC1_WEBGL:null;if(o===RGB_ETC2_Format||o===RGBA_ETC2_EAC_Format)if(d=e.get("WEBGL_compressed_texture_etc"),d!==null){if(o===RGB_ETC2_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ETC2:d.COMPRESSED_RGB8_ETC2;if(o===RGBA_ETC2_EAC_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:d.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(o===RGBA_ASTC_4x4_Format||o===RGBA_ASTC_5x4_Format||o===RGBA_ASTC_5x5_Format||o===RGBA_ASTC_6x5_Format||o===RGBA_ASTC_6x6_Format||o===RGBA_ASTC_8x5_Format||o===RGBA_ASTC_8x6_Format||o===RGBA_ASTC_8x8_Format||o===RGBA_ASTC_10x5_Format||o===RGBA_ASTC_10x6_Format||o===RGBA_ASTC_10x8_Format||o===RGBA_ASTC_10x10_Format||o===RGBA_ASTC_12x10_Format||o===RGBA_ASTC_12x12_Format)if(d=e.get("WEBGL_compressed_texture_astc"),d!==null){if(o===RGBA_ASTC_4x4_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:d.COMPRESSED_RGBA_ASTC_4x4_KHR;if(o===RGBA_ASTC_5x4_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:d.COMPRESSED_RGBA_ASTC_5x4_KHR;if(o===RGBA_ASTC_5x5_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:d.COMPRESSED_RGBA_ASTC_5x5_KHR;if(o===RGBA_ASTC_6x5_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:d.COMPRESSED_RGBA_ASTC_6x5_KHR;if(o===RGBA_ASTC_6x6_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:d.COMPRESSED_RGBA_ASTC_6x6_KHR;if(o===RGBA_ASTC_8x5_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:d.COMPRESSED_RGBA_ASTC_8x5_KHR;if(o===RGBA_ASTC_8x6_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:d.COMPRESSED_RGBA_ASTC_8x6_KHR;if(o===RGBA_ASTC_8x8_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:d.COMPRESSED_RGBA_ASTC_8x8_KHR;if(o===RGBA_ASTC_10x5_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:d.COMPRESSED_RGBA_ASTC_10x5_KHR;if(o===RGBA_ASTC_10x6_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:d.COMPRESSED_RGBA_ASTC_10x6_KHR;if(o===RGBA_ASTC_10x8_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:d.COMPRESSED_RGBA_ASTC_10x8_KHR;if(o===RGBA_ASTC_10x10_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:d.COMPRESSED_RGBA_ASTC_10x10_KHR;if(o===RGBA_ASTC_12x10_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:d.COMPRESSED_RGBA_ASTC_12x10_KHR;if(o===RGBA_ASTC_12x12_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:d.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(o===RGBA_BPTC_Format||o===RGB_BPTC_SIGNED_Format||o===RGB_BPTC_UNSIGNED_Format)if(d=e.get("EXT_texture_compression_bptc"),d!==null){if(o===RGBA_BPTC_Format)return g===SRGBTransfer?d.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:d.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(o===RGB_BPTC_SIGNED_Format)return d.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(o===RGB_BPTC_UNSIGNED_Format)return d.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(o===RED_RGTC1_Format||o===SIGNED_RED_RGTC1_Format||o===RED_GREEN_RGTC2_Format||o===SIGNED_RED_GREEN_RGTC2_Format)if(d=e.get("EXT_texture_compression_rgtc"),d!==null){if(o===RGBA_BPTC_Format)return d.COMPRESSED_RED_RGTC1_EXT;if(o===SIGNED_RED_RGTC1_Format)return d.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(o===RED_GREEN_RGTC2_Format)return d.COMPRESSED_RED_GREEN_RGTC2_EXT;if(o===SIGNED_RED_GREEN_RGTC2_Format)return d.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return o===UnsignedInt248Type?s.UNSIGNED_INT_24_8:s[o]!==void 0?s[o]:null}return{convert:a}}class ArrayCamera extends PerspectiveCamera{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}class Group extends Object3D{constructor(){super(),this.isGroup=!0,this.type="Group"}}const _moveEvent={type:"move"};class WebXRController{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Group,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Group,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new Vector3,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new Vector3),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Group,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new Vector3,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new Vector3),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const a=this._hand;if(a)for(const o of e.hand.values())this._getHandJoint(a,o)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,a,o){let c=null,d=null,g=null;const _=this._targetRay,b=this._grip,$=this._hand;if(e&&a.session.visibilityState!=="visible-blurred"){if($&&e.hand){g=!0;for(const at of e.hand.values()){const lt=a.getJointPose(at,o),_e=this._getHandJoint($,at);lt!==null&&(_e.matrix.fromArray(lt.transform.matrix),_e.matrix.decompose(_e.position,_e.rotation,_e.scale),_e.matrixWorldNeedsUpdate=!0,_e.jointRadius=lt.radius),_e.visible=lt!==null}const tt=$.joints["index-finger-tip"],rt=$.joints["thumb-tip"],et=tt.position.distanceTo(rt.position),st=.02,ot=.005;$.inputState.pinching&&et>st+ot?($.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!$.inputState.pinching&&et<=st-ot&&($.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else b!==null&&e.gripSpace&&(d=a.getPose(e.gripSpace,o),d!==null&&(b.matrix.fromArray(d.transform.matrix),b.matrix.decompose(b.position,b.rotation,b.scale),b.matrixWorldNeedsUpdate=!0,d.linearVelocity?(b.hasLinearVelocity=!0,b.linearVelocity.copy(d.linearVelocity)):b.hasLinearVelocity=!1,d.angularVelocity?(b.hasAngularVelocity=!0,b.angularVelocity.copy(d.angularVelocity)):b.hasAngularVelocity=!1));_!==null&&(c=a.getPose(e.targetRaySpace,o),c===null&&d!==null&&(c=d),c!==null&&(_.matrix.fromArray(c.transform.matrix),_.matrix.decompose(_.position,_.rotation,_.scale),_.matrixWorldNeedsUpdate=!0,c.linearVelocity?(_.hasLinearVelocity=!0,_.linearVelocity.copy(c.linearVelocity)):_.hasLinearVelocity=!1,c.angularVelocity?(_.hasAngularVelocity=!0,_.angularVelocity.copy(c.angularVelocity)):_.hasAngularVelocity=!1,this.dispatchEvent(_moveEvent)))}return _!==null&&(_.visible=c!==null),b!==null&&(b.visible=d!==null),$!==null&&($.visible=g!==null),this}_getHandJoint(e,a){if(e.joints[a.jointName]===void 0){const o=new Group;o.matrixAutoUpdate=!1,o.visible=!1,e.joints[a.jointName]=o,e.add(o)}return e.joints[a.jointName]}}const _occlusion_vertex=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,_occlusion_fragment=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class WebXRDepthSensing{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,a,o){if(this.texture===null){const c=new Texture,d=e.properties.get(c);d.__webglTexture=a.texture,(a.depthNear!=o.depthNear||a.depthFar!=o.depthFar)&&(this.depthNear=a.depthNear,this.depthFar=a.depthFar),this.texture=c}}render(e,a){if(this.texture!==null){if(this.mesh===null){const o=a.cameras[0].viewport,c=new ShaderMaterial({vertexShader:_occlusion_vertex,fragmentShader:_occlusion_fragment,uniforms:{depthColor:{value:this.texture},depthWidth:{value:o.z},depthHeight:{value:o.w}}});this.mesh=new Mesh(new PlaneGeometry(20,20),c)}e.render(this.mesh,a)}}reset(){this.texture=null,this.mesh=null}}class WebXRManager extends EventDispatcher{constructor(e,a){super();const o=this;let c=null,d=1,g=null,_="local-floor",b=1,$=null,tt=null,rt=null,et=null,st=null,ot=null;const at=new WebXRDepthSensing,lt=a.getContextAttributes();let _e=null,it=null;const nt=[],ct=[],ht=new Vector2;let ft=null;const pt=new PerspectiveCamera;pt.layers.enable(1),pt.viewport=new Vector4;const yt=new PerspectiveCamera;yt.layers.enable(2),yt.viewport=new Vector4;const vt=[pt,yt],gt=new ArrayCamera;gt.layers.enable(1),gt.layers.enable(2);let Ct=null,Pt=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(It){let Vt=nt[It];return Vt===void 0&&(Vt=new WebXRController,nt[It]=Vt),Vt.getTargetRaySpace()},this.getControllerGrip=function(It){let Vt=nt[It];return Vt===void 0&&(Vt=new WebXRController,nt[It]=Vt),Vt.getGripSpace()},this.getHand=function(It){let Vt=nt[It];return Vt===void 0&&(Vt=new WebXRController,nt[It]=Vt),Vt.getHandSpace()};function Tt(It){const Vt=ct.indexOf(It.inputSource);if(Vt===-1)return;const Wt=nt[Vt];Wt!==void 0&&(Wt.update(It.inputSource,It.frame,$||g),Wt.dispatchEvent({type:It.type,data:It.inputSource}))}function Rt(){c.removeEventListener("select",Tt),c.removeEventListener("selectstart",Tt),c.removeEventListener("selectend",Tt),c.removeEventListener("squeeze",Tt),c.removeEventListener("squeezestart",Tt),c.removeEventListener("squeezeend",Tt),c.removeEventListener("end",Rt),c.removeEventListener("inputsourceschange",wt);for(let It=0;It<nt.length;It++){const Vt=ct[It];Vt!==null&&(ct[It]=null,nt[It].disconnect(Vt))}Ct=null,Pt=null,at.reset(),e.setRenderTarget(_e),st=null,et=null,rt=null,c=null,it=null,Xt.stop(),o.isPresenting=!1,e.setPixelRatio(ft),e.setSize(ht.width,ht.height,!1),o.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(It){d=It,o.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(It){_=It,o.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return $||g},this.setReferenceSpace=function(It){$=It},this.getBaseLayer=function(){return et!==null?et:st},this.getBinding=function(){return rt},this.getFrame=function(){return ot},this.getSession=function(){return c},this.setSession=async function(It){if(c=It,c!==null){if(_e=e.getRenderTarget(),c.addEventListener("select",Tt),c.addEventListener("selectstart",Tt),c.addEventListener("selectend",Tt),c.addEventListener("squeeze",Tt),c.addEventListener("squeezestart",Tt),c.addEventListener("squeezeend",Tt),c.addEventListener("end",Rt),c.addEventListener("inputsourceschange",wt),lt.xrCompatible!==!0&&await a.makeXRCompatible(),ft=e.getPixelRatio(),e.getSize(ht),c.renderState.layers===void 0){const Vt={antialias:lt.antialias,alpha:!0,depth:lt.depth,stencil:lt.stencil,framebufferScaleFactor:d};st=new XRWebGLLayer(c,a,Vt),c.updateRenderState({baseLayer:st}),e.setPixelRatio(1),e.setSize(st.framebufferWidth,st.framebufferHeight,!1),it=new WebGLRenderTarget(st.framebufferWidth,st.framebufferHeight,{format:RGBAFormat,type:UnsignedByteType,colorSpace:e.outputColorSpace,stencilBuffer:lt.stencil})}else{let Vt=null,Wt=null,Kt=null;lt.depth&&(Kt=lt.stencil?a.DEPTH24_STENCIL8:a.DEPTH_COMPONENT24,Vt=lt.stencil?DepthStencilFormat:DepthFormat,Wt=lt.stencil?UnsignedInt248Type:UnsignedIntType);const ln={colorFormat:a.RGBA8,depthFormat:Kt,scaleFactor:d};rt=new XRWebGLBinding(c,a),et=rt.createProjectionLayer(ln),c.updateRenderState({layers:[et]}),e.setPixelRatio(1),e.setSize(et.textureWidth,et.textureHeight,!1),it=new WebGLRenderTarget(et.textureWidth,et.textureHeight,{format:RGBAFormat,type:UnsignedByteType,depthTexture:new DepthTexture(et.textureWidth,et.textureHeight,Wt,void 0,void 0,void 0,void 0,void 0,void 0,Vt),stencilBuffer:lt.stencil,colorSpace:e.outputColorSpace,samples:lt.antialias?4:0});const fn=e.properties.get(it);fn.__ignoreDepthValues=et.ignoreDepthValues}it.isXRRenderTarget=!0,this.setFoveation(b),$=null,g=await c.requestReferenceSpace(_),Xt.setContext(c),Xt.start(),o.isPresenting=!0,o.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(c!==null)return c.environmentBlendMode};function wt(It){for(let Vt=0;Vt<It.removed.length;Vt++){const Wt=It.removed[Vt],Kt=ct.indexOf(Wt);Kt>=0&&(ct[Kt]=null,nt[Kt].disconnect(Wt))}for(let Vt=0;Vt<It.added.length;Vt++){const Wt=It.added[Vt];let Kt=ct.indexOf(Wt);if(Kt===-1){for(let fn=0;fn<nt.length;fn++)if(fn>=ct.length){ct.push(Wt),Kt=fn;break}else if(ct[fn]===null){ct[fn]=Wt,Kt=fn;break}if(Kt===-1)break}const ln=nt[Kt];ln&&ln.connect(Wt)}}const _t=new Vector3,St=new Vector3;function ut(It,Vt,Wt){_t.setFromMatrixPosition(Vt.matrixWorld),St.setFromMatrixPosition(Wt.matrixWorld);const Kt=_t.distanceTo(St),ln=Vt.projectionMatrix.elements,fn=Wt.projectionMatrix.elements,dn=ln[14]/(ln[10]-1),Lt=ln[14]/(ln[10]+1),pn=(ln[9]+1)/ln[5],Jt=(ln[9]-1)/ln[5],Qt=(ln[8]-1)/ln[0],cn=(fn[8]+1)/fn[0],En=dn*Qt,bt=dn*cn,xt=Kt/(-Qt+cn),Ft=xt*-Qt;Vt.matrixWorld.decompose(It.position,It.quaternion,It.scale),It.translateX(Ft),It.translateZ(xt),It.matrixWorld.compose(It.position,It.quaternion,It.scale),It.matrixWorldInverse.copy(It.matrixWorld).invert();const Gt=dn+xt,zt=Lt+xt,jt=En-Ft,on=bt+(Kt-Ft),Yt=pn*Lt/zt*Gt,rn=Jt*Lt/zt*Gt;It.projectionMatrix.makePerspective(jt,on,Yt,rn,Gt,zt),It.projectionMatrixInverse.copy(It.projectionMatrix).invert()}function dt(It,Vt){Vt===null?It.matrixWorld.copy(It.matrix):It.matrixWorld.multiplyMatrices(Vt.matrixWorld,It.matrix),It.matrixWorldInverse.copy(It.matrixWorld).invert()}this.updateCamera=function(It){if(c===null)return;at.texture!==null&&(It.near=at.depthNear,It.far=at.depthFar),gt.near=yt.near=pt.near=It.near,gt.far=yt.far=pt.far=It.far,(Ct!==gt.near||Pt!==gt.far)&&(c.updateRenderState({depthNear:gt.near,depthFar:gt.far}),Ct=gt.near,Pt=gt.far,pt.near=Ct,pt.far=Pt,yt.near=Ct,yt.far=Pt,pt.updateProjectionMatrix(),yt.updateProjectionMatrix(),It.updateProjectionMatrix());const Vt=It.parent,Wt=gt.cameras;dt(gt,Vt);for(let Kt=0;Kt<Wt.length;Kt++)dt(Wt[Kt],Vt);Wt.length===2?ut(gt,pt,yt):gt.projectionMatrix.copy(pt.projectionMatrix),Mt(It,gt,Vt)};function Mt(It,Vt,Wt){Wt===null?It.matrix.copy(Vt.matrixWorld):(It.matrix.copy(Wt.matrixWorld),It.matrix.invert(),It.matrix.multiply(Vt.matrixWorld)),It.matrix.decompose(It.position,It.quaternion,It.scale),It.updateMatrixWorld(!0),It.projectionMatrix.copy(Vt.projectionMatrix),It.projectionMatrixInverse.copy(Vt.projectionMatrixInverse),It.isPerspectiveCamera&&(It.fov=RAD2DEG*2*Math.atan(1/It.projectionMatrix.elements[5]),It.zoom=1)}this.getCamera=function(){return gt},this.getFoveation=function(){if(!(et===null&&st===null))return b},this.setFoveation=function(It){b=It,et!==null&&(et.fixedFoveation=It),st!==null&&st.fixedFoveation!==void 0&&(st.fixedFoveation=It)},this.hasDepthSensing=function(){return at.texture!==null};let At=null;function Bt(It,Vt){if(tt=Vt.getViewerPose($||g),ot=Vt,tt!==null){const Wt=tt.views;st!==null&&(e.setRenderTargetFramebuffer(it,st.framebuffer),e.setRenderTarget(it));let Kt=!1;Wt.length!==gt.cameras.length&&(gt.cameras.length=0,Kt=!0);for(let fn=0;fn<Wt.length;fn++){const dn=Wt[fn];let Lt=null;if(st!==null)Lt=st.getViewport(dn);else{const Jt=rt.getViewSubImage(et,dn);Lt=Jt.viewport,fn===0&&(e.setRenderTargetTextures(it,Jt.colorTexture,et.ignoreDepthValues?void 0:Jt.depthStencilTexture),e.setRenderTarget(it))}let pn=vt[fn];pn===void 0&&(pn=new PerspectiveCamera,pn.layers.enable(fn),pn.viewport=new Vector4,vt[fn]=pn),pn.matrix.fromArray(dn.transform.matrix),pn.matrix.decompose(pn.position,pn.quaternion,pn.scale),pn.projectionMatrix.fromArray(dn.projectionMatrix),pn.projectionMatrixInverse.copy(pn.projectionMatrix).invert(),pn.viewport.set(Lt.x,Lt.y,Lt.width,Lt.height),fn===0&&(gt.matrix.copy(pn.matrix),gt.matrix.decompose(gt.position,gt.quaternion,gt.scale)),Kt===!0&&gt.cameras.push(pn)}const ln=c.enabledFeatures;if(ln&&ln.includes("depth-sensing")){const fn=rt.getDepthInformation(Wt[0]);fn&&fn.isValid&&fn.texture&&at.init(e,fn,c.renderState)}}for(let Wt=0;Wt<nt.length;Wt++){const Kt=ct[Wt],ln=nt[Wt];Kt!==null&&ln!==void 0&&ln.update(Kt,Vt,$||g)}at.render(e,gt),At&&At(It,Vt),Vt.detectedPlanes&&o.dispatchEvent({type:"planesdetected",data:Vt}),ot=null}const Xt=new WebGLAnimation;Xt.setAnimationLoop(Bt),this.setAnimationLoop=function(It){At=It},this.dispose=function(){}}}const _e1=new Euler,_m1=new Matrix4;function WebGLMaterials(s,e){function a(lt,_e){lt.matrixAutoUpdate===!0&&lt.updateMatrix(),_e.value.copy(lt.matrix)}function o(lt,_e){_e.color.getRGB(lt.fogColor.value,getUnlitUniformColorSpace(s)),_e.isFog?(lt.fogNear.value=_e.near,lt.fogFar.value=_e.far):_e.isFogExp2&&(lt.fogDensity.value=_e.density)}function c(lt,_e,it,nt,ct){_e.isMeshBasicMaterial||_e.isMeshLambertMaterial?d(lt,_e):_e.isMeshToonMaterial?(d(lt,_e),rt(lt,_e)):_e.isMeshPhongMaterial?(d(lt,_e),tt(lt,_e)):_e.isMeshStandardMaterial?(d(lt,_e),et(lt,_e),_e.isMeshPhysicalMaterial&&st(lt,_e,ct)):_e.isMeshMatcapMaterial?(d(lt,_e),ot(lt,_e)):_e.isMeshDepthMaterial?d(lt,_e):_e.isMeshDistanceMaterial?(d(lt,_e),at(lt,_e)):_e.isMeshNormalMaterial?d(lt,_e):_e.isLineBasicMaterial?(g(lt,_e),_e.isLineDashedMaterial&&_(lt,_e)):_e.isPointsMaterial?b(lt,_e,it,nt):_e.isSpriteMaterial?$(lt,_e):_e.isShadowMaterial?(lt.color.value.copy(_e.color),lt.opacity.value=_e.opacity):_e.isShaderMaterial&&(_e.uniformsNeedUpdate=!1)}function d(lt,_e){lt.opacity.value=_e.opacity,_e.color&&lt.diffuse.value.copy(_e.color),_e.emissive&&lt.emissive.value.copy(_e.emissive).multiplyScalar(_e.emissiveIntensity),_e.map&&(lt.map.value=_e.map,a(_e.map,lt.mapTransform)),_e.alphaMap&&(lt.alphaMap.value=_e.alphaMap,a(_e.alphaMap,lt.alphaMapTransform)),_e.bumpMap&&(lt.bumpMap.value=_e.bumpMap,a(_e.bumpMap,lt.bumpMapTransform),lt.bumpScale.value=_e.bumpScale,_e.side===BackSide&&(lt.bumpScale.value*=-1)),_e.normalMap&&(lt.normalMap.value=_e.normalMap,a(_e.normalMap,lt.normalMapTransform),lt.normalScale.value.copy(_e.normalScale),_e.side===BackSide&&lt.normalScale.value.negate()),_e.displacementMap&&(lt.displacementMap.value=_e.displacementMap,a(_e.displacementMap,lt.displacementMapTransform),lt.displacementScale.value=_e.displacementScale,lt.displacementBias.value=_e.displacementBias),_e.emissiveMap&&(lt.emissiveMap.value=_e.emissiveMap,a(_e.emissiveMap,lt.emissiveMapTransform)),_e.specularMap&&(lt.specularMap.value=_e.specularMap,a(_e.specularMap,lt.specularMapTransform)),_e.alphaTest>0&&(lt.alphaTest.value=_e.alphaTest);const it=e.get(_e),nt=it.envMap,ct=it.envMapRotation;if(nt&&(lt.envMap.value=nt,_e1.copy(ct),_e1.x*=-1,_e1.y*=-1,_e1.z*=-1,nt.isCubeTexture&&nt.isRenderTargetTexture===!1&&(_e1.y*=-1,_e1.z*=-1),lt.envMapRotation.value.setFromMatrix4(_m1.makeRotationFromEuler(_e1)),lt.flipEnvMap.value=nt.isCubeTexture&&nt.isRenderTargetTexture===!1?-1:1,lt.reflectivity.value=_e.reflectivity,lt.ior.value=_e.ior,lt.refractionRatio.value=_e.refractionRatio),_e.lightMap){lt.lightMap.value=_e.lightMap;const ht=s._useLegacyLights===!0?Math.PI:1;lt.lightMapIntensity.value=_e.lightMapIntensity*ht,a(_e.lightMap,lt.lightMapTransform)}_e.aoMap&&(lt.aoMap.value=_e.aoMap,lt.aoMapIntensity.value=_e.aoMapIntensity,a(_e.aoMap,lt.aoMapTransform))}function g(lt,_e){lt.diffuse.value.copy(_e.color),lt.opacity.value=_e.opacity,_e.map&&(lt.map.value=_e.map,a(_e.map,lt.mapTransform))}function _(lt,_e){lt.dashSize.value=_e.dashSize,lt.totalSize.value=_e.dashSize+_e.gapSize,lt.scale.value=_e.scale}function b(lt,_e,it,nt){lt.diffuse.value.copy(_e.color),lt.opacity.value=_e.opacity,lt.size.value=_e.size*it,lt.scale.value=nt*.5,_e.map&&(lt.map.value=_e.map,a(_e.map,lt.uvTransform)),_e.alphaMap&&(lt.alphaMap.value=_e.alphaMap,a(_e.alphaMap,lt.alphaMapTransform)),_e.alphaTest>0&&(lt.alphaTest.value=_e.alphaTest)}function $(lt,_e){lt.diffuse.value.copy(_e.color),lt.opacity.value=_e.opacity,lt.rotation.value=_e.rotation,_e.map&&(lt.map.value=_e.map,a(_e.map,lt.mapTransform)),_e.alphaMap&&(lt.alphaMap.value=_e.alphaMap,a(_e.alphaMap,lt.alphaMapTransform)),_e.alphaTest>0&&(lt.alphaTest.value=_e.alphaTest)}function tt(lt,_e){lt.specular.value.copy(_e.specular),lt.shininess.value=Math.max(_e.shininess,1e-4)}function rt(lt,_e){_e.gradientMap&&(lt.gradientMap.value=_e.gradientMap)}function et(lt,_e){lt.metalness.value=_e.metalness,_e.metalnessMap&&(lt.metalnessMap.value=_e.metalnessMap,a(_e.metalnessMap,lt.metalnessMapTransform)),lt.roughness.value=_e.roughness,_e.roughnessMap&&(lt.roughnessMap.value=_e.roughnessMap,a(_e.roughnessMap,lt.roughnessMapTransform)),_e.envMap&&(lt.envMapIntensity.value=_e.envMapIntensity)}function st(lt,_e,it){lt.ior.value=_e.ior,_e.sheen>0&&(lt.sheenColor.value.copy(_e.sheenColor).multiplyScalar(_e.sheen),lt.sheenRoughness.value=_e.sheenRoughness,_e.sheenColorMap&&(lt.sheenColorMap.value=_e.sheenColorMap,a(_e.sheenColorMap,lt.sheenColorMapTransform)),_e.sheenRoughnessMap&&(lt.sheenRoughnessMap.value=_e.sheenRoughnessMap,a(_e.sheenRoughnessMap,lt.sheenRoughnessMapTransform))),_e.clearcoat>0&&(lt.clearcoat.value=_e.clearcoat,lt.clearcoatRoughness.value=_e.clearcoatRoughness,_e.clearcoatMap&&(lt.clearcoatMap.value=_e.clearcoatMap,a(_e.clearcoatMap,lt.clearcoatMapTransform)),_e.clearcoatRoughnessMap&&(lt.clearcoatRoughnessMap.value=_e.clearcoatRoughnessMap,a(_e.clearcoatRoughnessMap,lt.clearcoatRoughnessMapTransform)),_e.clearcoatNormalMap&&(lt.clearcoatNormalMap.value=_e.clearcoatNormalMap,a(_e.clearcoatNormalMap,lt.clearcoatNormalMapTransform),lt.clearcoatNormalScale.value.copy(_e.clearcoatNormalScale),_e.side===BackSide&&lt.clearcoatNormalScale.value.negate())),_e.iridescence>0&&(lt.iridescence.value=_e.iridescence,lt.iridescenceIOR.value=_e.iridescenceIOR,lt.iridescenceThicknessMinimum.value=_e.iridescenceThicknessRange[0],lt.iridescenceThicknessMaximum.value=_e.iridescenceThicknessRange[1],_e.iridescenceMap&&(lt.iridescenceMap.value=_e.iridescenceMap,a(_e.iridescenceMap,lt.iridescenceMapTransform)),_e.iridescenceThicknessMap&&(lt.iridescenceThicknessMap.value=_e.iridescenceThicknessMap,a(_e.iridescenceThicknessMap,lt.iridescenceThicknessMapTransform))),_e.transmission>0&&(lt.transmission.value=_e.transmission,lt.transmissionSamplerMap.value=it.texture,lt.transmissionSamplerSize.value.set(it.width,it.height),_e.transmissionMap&&(lt.transmissionMap.value=_e.transmissionMap,a(_e.transmissionMap,lt.transmissionMapTransform)),lt.thickness.value=_e.thickness,_e.thicknessMap&&(lt.thicknessMap.value=_e.thicknessMap,a(_e.thicknessMap,lt.thicknessMapTransform)),lt.attenuationDistance.value=_e.attenuationDistance,lt.attenuationColor.value.copy(_e.attenuationColor)),_e.anisotropy>0&&(lt.anisotropyVector.value.set(_e.anisotropy*Math.cos(_e.anisotropyRotation),_e.anisotropy*Math.sin(_e.anisotropyRotation)),_e.anisotropyMap&&(lt.anisotropyMap.value=_e.anisotropyMap,a(_e.anisotropyMap,lt.anisotropyMapTransform))),lt.specularIntensity.value=_e.specularIntensity,lt.specularColor.value.copy(_e.specularColor),_e.specularColorMap&&(lt.specularColorMap.value=_e.specularColorMap,a(_e.specularColorMap,lt.specularColorMapTransform)),_e.specularIntensityMap&&(lt.specularIntensityMap.value=_e.specularIntensityMap,a(_e.specularIntensityMap,lt.specularIntensityMapTransform))}function ot(lt,_e){_e.matcap&&(lt.matcap.value=_e.matcap)}function at(lt,_e){const it=e.get(_e).light;lt.referencePosition.value.setFromMatrixPosition(it.matrixWorld),lt.nearDistance.value=it.shadow.camera.near,lt.farDistance.value=it.shadow.camera.far}return{refreshFogUniforms:o,refreshMaterialUniforms:c}}function WebGLUniformsGroups(s,e,a,o){let c={},d={},g=[];const _=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function b(it,nt){const ct=nt.program;o.uniformBlockBinding(it,ct)}function $(it,nt){let ct=c[it.id];ct===void 0&&(ot(it),ct=tt(it),c[it.id]=ct,it.addEventListener("dispose",lt));const ht=nt.program;o.updateUBOMapping(it,ht);const ft=e.render.frame;d[it.id]!==ft&&(et(it),d[it.id]=ft)}function tt(it){const nt=rt();it.__bindingPointIndex=nt;const ct=s.createBuffer(),ht=it.__size,ft=it.usage;return s.bindBuffer(s.UNIFORM_BUFFER,ct),s.bufferData(s.UNIFORM_BUFFER,ht,ft),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,nt,ct),ct}function rt(){for(let it=0;it<_;it++)if(g.indexOf(it)===-1)return g.push(it),it;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function et(it){const nt=c[it.id],ct=it.uniforms,ht=it.__cache;s.bindBuffer(s.UNIFORM_BUFFER,nt);for(let ft=0,pt=ct.length;ft<pt;ft++){const yt=Array.isArray(ct[ft])?ct[ft]:[ct[ft]];for(let vt=0,gt=yt.length;vt<gt;vt++){const Ct=yt[vt];if(st(Ct,ft,vt,ht)===!0){const Pt=Ct.__offset,Tt=Array.isArray(Ct.value)?Ct.value:[Ct.value];let Rt=0;for(let wt=0;wt<Tt.length;wt++){const _t=Tt[wt],St=at(_t);typeof _t=="number"||typeof _t=="boolean"?(Ct.__data[0]=_t,s.bufferSubData(s.UNIFORM_BUFFER,Pt+Rt,Ct.__data)):_t.isMatrix3?(Ct.__data[0]=_t.elements[0],Ct.__data[1]=_t.elements[1],Ct.__data[2]=_t.elements[2],Ct.__data[3]=0,Ct.__data[4]=_t.elements[3],Ct.__data[5]=_t.elements[4],Ct.__data[6]=_t.elements[5],Ct.__data[7]=0,Ct.__data[8]=_t.elements[6],Ct.__data[9]=_t.elements[7],Ct.__data[10]=_t.elements[8],Ct.__data[11]=0):(_t.toArray(Ct.__data,Rt),Rt+=St.storage/Float32Array.BYTES_PER_ELEMENT)}s.bufferSubData(s.UNIFORM_BUFFER,Pt,Ct.__data)}}}s.bindBuffer(s.UNIFORM_BUFFER,null)}function st(it,nt,ct,ht){const ft=it.value,pt=nt+"_"+ct;if(ht[pt]===void 0)return typeof ft=="number"||typeof ft=="boolean"?ht[pt]=ft:ht[pt]=ft.clone(),!0;{const yt=ht[pt];if(typeof ft=="number"||typeof ft=="boolean"){if(yt!==ft)return ht[pt]=ft,!0}else if(yt.equals(ft)===!1)return yt.copy(ft),!0}return!1}function ot(it){const nt=it.uniforms;let ct=0;const ht=16;for(let pt=0,yt=nt.length;pt<yt;pt++){const vt=Array.isArray(nt[pt])?nt[pt]:[nt[pt]];for(let gt=0,Ct=vt.length;gt<Ct;gt++){const Pt=vt[gt],Tt=Array.isArray(Pt.value)?Pt.value:[Pt.value];for(let Rt=0,wt=Tt.length;Rt<wt;Rt++){const _t=Tt[Rt],St=at(_t),ut=ct%ht;ut!==0&&ht-ut<St.boundary&&(ct+=ht-ut),Pt.__data=new Float32Array(St.storage/Float32Array.BYTES_PER_ELEMENT),Pt.__offset=ct,ct+=St.storage}}}const ft=ct%ht;return ft>0&&(ct+=ht-ft),it.__size=ct,it.__cache={},this}function at(it){const nt={boundary:0,storage:0};return typeof it=="number"||typeof it=="boolean"?(nt.boundary=4,nt.storage=4):it.isVector2?(nt.boundary=8,nt.storage=8):it.isVector3||it.isColor?(nt.boundary=16,nt.storage=12):it.isVector4?(nt.boundary=16,nt.storage=16):it.isMatrix3?(nt.boundary=48,nt.storage=48):it.isMatrix4?(nt.boundary=64,nt.storage=64):it.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",it),nt}function lt(it){const nt=it.target;nt.removeEventListener("dispose",lt);const ct=g.indexOf(nt.__bindingPointIndex);g.splice(ct,1),s.deleteBuffer(c[nt.id]),delete c[nt.id],delete d[nt.id]}function _e(){for(const it in c)s.deleteBuffer(c[it]);g=[],c={},d={}}return{bind:b,update:$,dispose:_e}}class WebGLRenderer{constructor(e={}){const{canvas:a=createCanvasElement(),context:o=null,depth:c=!0,stencil:d=!1,alpha:g=!1,antialias:_=!1,premultipliedAlpha:b=!0,preserveDrawingBuffer:$=!1,powerPreference:tt="default",failIfMajorPerformanceCaveat:rt=!1}=e;this.isWebGLRenderer=!0;let et;if(o!==null){if(typeof WebGLRenderingContext<"u"&&o instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");et=o.getContextAttributes().alpha}else et=g;const st=new Uint32Array(4),ot=new Int32Array(4);let at=null,lt=null;const _e=[],it=[];this.domElement=a,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=SRGBColorSpace,this._useLegacyLights=!1,this.toneMapping=NoToneMapping,this.toneMappingExposure=1;const nt=this;let ct=!1,ht=0,ft=0,pt=null,yt=-1,vt=null;const gt=new Vector4,Ct=new Vector4;let Pt=null;const Tt=new Color(0);let Rt=0,wt=a.width,_t=a.height,St=1,ut=null,dt=null;const Mt=new Vector4(0,0,wt,_t),At=new Vector4(0,0,wt,_t);let Bt=!1;const Xt=new Frustum;let It=!1,Vt=!1;const Wt=new Matrix4,Kt=new Vector2,ln=new Vector3,fn={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};function dn(){return pt===null?St:1}let Lt=o;function pn(Et,Dt){const Ot=a.getContext(Et,Dt);return Ot!==null?Ot:null}try{const Et={alpha:!0,depth:c,stencil:d,antialias:_,premultipliedAlpha:b,preserveDrawingBuffer:$,powerPreference:tt,failIfMajorPerformanceCaveat:rt};if("setAttribute"in a&&a.setAttribute("data-engine",`three.js r${REVISION}`),a.addEventListener("webglcontextlost",kt,!1),a.addEventListener("webglcontextrestored",Ht,!1),a.addEventListener("webglcontextcreationerror",Zt,!1),Lt===null){const Dt="webgl2";if(Lt=pn(Dt,Et),Lt===null)throw pn(Dt)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(Et){throw console.error("THREE.WebGLRenderer: "+Et.message),Et}let Jt,Qt,cn,En,bt,xt,Ft,Gt,zt,jt,on,Yt,rn,sn,qt,$t,mn,nn,an,An,Tn,Pn,Cn,wn;function un(){Jt=new WebGLExtensions(Lt),Jt.init(),Qt=new WebGLCapabilities(Lt,Jt,e),Pn=new WebGLUtils(Lt,Jt),cn=new WebGLState(Lt),En=new WebGLInfo(Lt),bt=new WebGLProperties,xt=new WebGLTextures(Lt,Jt,cn,bt,Qt,Pn,En),Ft=new WebGLCubeMaps(nt),Gt=new WebGLCubeUVMaps(nt),zt=new WebGLAttributes(Lt),Cn=new WebGLBindingStates(Lt,zt),jt=new WebGLGeometries(Lt,zt,En,Cn),on=new WebGLObjects(Lt,jt,zt,En),an=new WebGLMorphtargets(Lt,Qt,xt),$t=new WebGLClipping(bt),Yt=new WebGLPrograms(nt,Ft,Gt,Jt,Qt,Cn,$t),rn=new WebGLMaterials(nt,bt),sn=new WebGLRenderLists,qt=new WebGLRenderStates(Jt),nn=new WebGLBackground(nt,Ft,Gt,cn,on,et,b),mn=new WebGLShadowMap(nt,on,Qt),wn=new WebGLUniformsGroups(Lt,En,Qt,cn),An=new WebGLBufferRenderer(Lt,Jt,En),Tn=new WebGLIndexedBufferRenderer(Lt,Jt,En),En.programs=Yt.programs,nt.capabilities=Qt,nt.extensions=Jt,nt.properties=bt,nt.renderLists=sn,nt.shadowMap=mn,nt.state=cn,nt.info=En}un();const mt=new WebXRManager(nt,Lt);this.xr=mt,this.getContext=function(){return Lt},this.getContextAttributes=function(){return Lt.getContextAttributes()},this.forceContextLoss=function(){const Et=Jt.get("WEBGL_lose_context");Et&&Et.loseContext()},this.forceContextRestore=function(){const Et=Jt.get("WEBGL_lose_context");Et&&Et.restoreContext()},this.getPixelRatio=function(){return St},this.setPixelRatio=function(Et){Et!==void 0&&(St=Et,this.setSize(wt,_t,!1))},this.getSize=function(Et){return Et.set(wt,_t)},this.setSize=function(Et,Dt,Ot=!0){if(mt.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}wt=Et,_t=Dt,a.width=Math.floor(Et*St),a.height=Math.floor(Dt*St),Ot===!0&&(a.style.width=Et+"px",a.style.height=Dt+"px"),this.setViewport(0,0,Et,Dt)},this.getDrawingBufferSize=function(Et){return Et.set(wt*St,_t*St).floor()},this.setDrawingBufferSize=function(Et,Dt,Ot){wt=Et,_t=Dt,St=Ot,a.width=Math.floor(Et*Ot),a.height=Math.floor(Dt*Ot),this.setViewport(0,0,Et,Dt)},this.getCurrentViewport=function(Et){return Et.copy(gt)},this.getViewport=function(Et){return Et.copy(Mt)},this.setViewport=function(Et,Dt,Ot,Ut){Et.isVector4?Mt.set(Et.x,Et.y,Et.z,Et.w):Mt.set(Et,Dt,Ot,Ut),cn.viewport(gt.copy(Mt).multiplyScalar(St).round())},this.getScissor=function(Et){return Et.copy(At)},this.setScissor=function(Et,Dt,Ot,Ut){Et.isVector4?At.set(Et.x,Et.y,Et.z,Et.w):At.set(Et,Dt,Ot,Ut),cn.scissor(Ct.copy(At).multiplyScalar(St).round())},this.getScissorTest=function(){return Bt},this.setScissorTest=function(Et){cn.setScissorTest(Bt=Et)},this.setOpaqueSort=function(Et){ut=Et},this.setTransparentSort=function(Et){dt=Et},this.getClearColor=function(Et){return Et.copy(nn.getClearColor())},this.setClearColor=function(){nn.setClearColor.apply(nn,arguments)},this.getClearAlpha=function(){return nn.getClearAlpha()},this.setClearAlpha=function(){nn.setClearAlpha.apply(nn,arguments)},this.clear=function(Et=!0,Dt=!0,Ot=!0){let Ut=0;if(Et){let Nt=!1;if(pt!==null){const en=pt.texture.format;Nt=en===RGBAIntegerFormat||en===RGIntegerFormat||en===RedIntegerFormat}if(Nt){const en=pt.texture.type,hn=en===UnsignedByteType||en===UnsignedIntType||en===UnsignedShortType||en===UnsignedInt248Type||en===UnsignedShort4444Type||en===UnsignedShort5551Type,gn=nn.getClearColor(),vn=nn.getClearAlpha(),_n=gn.r,yn=gn.g,xn=gn.b;hn?(st[0]=_n,st[1]=yn,st[2]=xn,st[3]=vn,Lt.clearBufferuiv(Lt.COLOR,0,st)):(ot[0]=_n,ot[1]=yn,ot[2]=xn,ot[3]=vn,Lt.clearBufferiv(Lt.COLOR,0,ot))}else Ut|=Lt.COLOR_BUFFER_BIT}Dt&&(Ut|=Lt.DEPTH_BUFFER_BIT),Ot&&(Ut|=Lt.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),Lt.clear(Ut)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){a.removeEventListener("webglcontextlost",kt,!1),a.removeEventListener("webglcontextrestored",Ht,!1),a.removeEventListener("webglcontextcreationerror",Zt,!1),sn.dispose(),qt.dispose(),bt.dispose(),Ft.dispose(),Gt.dispose(),on.dispose(),Cn.dispose(),wn.dispose(),Yt.dispose(),mt.dispose(),mt.removeEventListener("sessionstart",kn),mt.removeEventListener("sessionend",Nn),Vn.stop()};function kt(Et){Et.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),ct=!0}function Ht(){console.log("THREE.WebGLRenderer: Context Restored."),ct=!1;const Et=En.autoReset,Dt=mn.enabled,Ot=mn.autoUpdate,Ut=mn.needsUpdate,Nt=mn.type;un(),En.autoReset=Et,mn.enabled=Dt,mn.autoUpdate=Ot,mn.needsUpdate=Ut,mn.type=Nt}function Zt(Et){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",Et.statusMessage)}function tn(Et){const Dt=Et.target;Dt.removeEventListener("dispose",tn),bn(Dt)}function bn(Et){Mn(Et),bt.remove(Et)}function Mn(Et){const Dt=bt.get(Et).programs;Dt!==void 0&&(Dt.forEach(function(Ot){Yt.releaseProgram(Ot)}),Et.isShaderMaterial&&Yt.releaseShaderCache(Et))}this.renderBufferDirect=function(Et,Dt,Ot,Ut,Nt,en){Dt===null&&(Dt=fn);const hn=Nt.isMesh&&Nt.matrixWorld.determinant()<0,gn=or(Et,Dt,Ot,Ut,Nt);cn.setMaterial(Ut,hn);let vn=Ot.index,_n=1;if(Ut.wireframe===!0){if(vn=jt.getWireframeAttribute(Ot),vn===void 0)return;_n=2}const yn=Ot.drawRange,xn=Ot.attributes.position;let Fn=yn.start*_n,Gn=(yn.start+yn.count)*_n;en!==null&&(Fn=Math.max(Fn,en.start*_n),Gn=Math.min(Gn,(en.start+en.count)*_n)),vn!==null?(Fn=Math.max(Fn,0),Gn=Math.min(Gn,vn.count)):xn!=null&&(Fn=Math.max(Fn,0),Gn=Math.min(Gn,xn.count));const Un=Gn-Fn;if(Un<0||Un===1/0)return;Cn.setup(Nt,Ut,gn,Ot,vn);let jn,Dn=An;if(vn!==null&&(jn=zt.get(vn),Dn=Tn,Dn.setIndex(jn)),Nt.isMesh)Ut.wireframe===!0?(cn.setLineWidth(Ut.wireframeLinewidth*dn()),Dn.setMode(Lt.LINES)):Dn.setMode(Lt.TRIANGLES);else if(Nt.isLine){let Sn=Ut.linewidth;Sn===void 0&&(Sn=1),cn.setLineWidth(Sn*dn()),Nt.isLineSegments?Dn.setMode(Lt.LINES):Nt.isLineLoop?Dn.setMode(Lt.LINE_LOOP):Dn.setMode(Lt.LINE_STRIP)}else Nt.isPoints?Dn.setMode(Lt.POINTS):Nt.isSprite&&Dn.setMode(Lt.TRIANGLES);if(Nt.isBatchedMesh)Dn.renderMultiDraw(Nt._multiDrawStarts,Nt._multiDrawCounts,Nt._multiDrawCount);else if(Nt.isInstancedMesh)Dn.renderInstances(Fn,Un,Nt.count);else if(Ot.isInstancedBufferGeometry){const Sn=Ot._maxInstanceCount!==void 0?Ot._maxInstanceCount:1/0,Jn=Math.min(Ot.instanceCount,Sn);Dn.renderInstances(Fn,Un,Jn)}else Dn.render(Fn,Un)};function In(Et,Dt,Ot){Et.transparent===!0&&Et.side===DoubleSide&&Et.forceSinglePass===!1?(Et.side=BackSide,Et.needsUpdate=!0,Zn(Et,Dt,Ot),Et.side=FrontSide,Et.needsUpdate=!0,Zn(Et,Dt,Ot),Et.side=DoubleSide):Zn(Et,Dt,Ot)}this.compile=function(Et,Dt,Ot=null){Ot===null&&(Ot=Et),lt=qt.get(Ot),lt.init(),it.push(lt),Ot.traverseVisible(function(Nt){Nt.isLight&&Nt.layers.test(Dt.layers)&&(lt.pushLight(Nt),Nt.castShadow&&lt.pushShadow(Nt))}),Et!==Ot&&Et.traverseVisible(function(Nt){Nt.isLight&&Nt.layers.test(Dt.layers)&&(lt.pushLight(Nt),Nt.castShadow&&lt.pushShadow(Nt))}),lt.setupLights(nt._useLegacyLights);const Ut=new Set;return Et.traverse(function(Nt){const en=Nt.material;if(en)if(Array.isArray(en))for(let hn=0;hn<en.length;hn++){const gn=en[hn];In(gn,Ot,Nt),Ut.add(gn)}else In(en,Ot,Nt),Ut.add(en)}),it.pop(),lt=null,Ut},this.compileAsync=function(Et,Dt,Ot=null){const Ut=this.compile(Et,Dt,Ot);return new Promise(Nt=>{function en(){if(Ut.forEach(function(hn){bt.get(hn).currentProgram.isReady()&&Ut.delete(hn)}),Ut.size===0){Nt(Et);return}setTimeout(en,10)}Jt.get("KHR_parallel_shader_compile")!==null?en():setTimeout(en,10)})};let On=null;function Rn(Et){On&&On(Et)}function kn(){Vn.stop()}function Nn(){Vn.start()}const Vn=new WebGLAnimation;Vn.setAnimationLoop(Rn),typeof self<"u"&&Vn.setContext(self),this.setAnimationLoop=function(Et){On=Et,mt.setAnimationLoop(Et),Et===null?Vn.stop():Vn.start()},mt.addEventListener("sessionstart",kn),mt.addEventListener("sessionend",Nn),this.render=function(Et,Dt){if(Dt!==void 0&&Dt.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(ct===!0)return;Et.matrixWorldAutoUpdate===!0&&Et.updateMatrixWorld(),Dt.parent===null&&Dt.matrixWorldAutoUpdate===!0&&Dt.updateMatrixWorld(),mt.enabled===!0&&mt.isPresenting===!0&&(mt.cameraAutoUpdate===!0&&mt.updateCamera(Dt),Dt=mt.getCamera()),Et.isScene===!0&&Et.onBeforeRender(nt,Et,Dt,pt),lt=qt.get(Et,it.length),lt.init(),it.push(lt),Wt.multiplyMatrices(Dt.projectionMatrix,Dt.matrixWorldInverse),Xt.setFromProjectionMatrix(Wt),Vt=this.localClippingEnabled,It=$t.init(this.clippingPlanes,Vt),at=sn.get(Et,_e.length),at.init(),_e.push(at),zn(Et,Dt,0,nt.sortObjects),at.finish(),nt.sortObjects===!0&&at.sort(ut,dt),this.info.render.frame++,It===!0&&$t.beginShadows();const Ot=lt.state.shadowsArray;if(mn.render(Ot,Et,Dt),It===!0&&$t.endShadows(),this.info.autoReset===!0&&this.info.reset(),(mt.enabled===!1||mt.isPresenting===!1||mt.hasDepthSensing()===!1)&&nn.render(at,Et),lt.setupLights(nt._useLegacyLights),Dt.isArrayCamera){const Ut=Dt.cameras;for(let Nt=0,en=Ut.length;Nt<en;Nt++){const hn=Ut[Nt];Wn(at,Et,hn,hn.viewport)}}else Wn(at,Et,Dt);pt!==null&&(xt.updateMultisampleRenderTarget(pt),xt.updateRenderTargetMipmap(pt)),Et.isScene===!0&&Et.onAfterRender(nt,Et,Dt),Cn.resetDefaultState(),yt=-1,vt=null,it.pop(),it.length>0?lt=it[it.length-1]:lt=null,_e.pop(),_e.length>0?at=_e[_e.length-1]:at=null};function zn(Et,Dt,Ot,Ut){if(Et.visible===!1)return;if(Et.layers.test(Dt.layers)){if(Et.isGroup)Ot=Et.renderOrder;else if(Et.isLOD)Et.autoUpdate===!0&&Et.update(Dt);else if(Et.isLight)lt.pushLight(Et),Et.castShadow&&lt.pushShadow(Et);else if(Et.isSprite){if(!Et.frustumCulled||Xt.intersectsSprite(Et)){Ut&&ln.setFromMatrixPosition(Et.matrixWorld).applyMatrix4(Wt);const hn=on.update(Et),gn=Et.material;gn.visible&&at.push(Et,hn,gn,Ot,ln.z,null)}}else if((Et.isMesh||Et.isLine||Et.isPoints)&&(!Et.frustumCulled||Xt.intersectsObject(Et))){const hn=on.update(Et),gn=Et.material;if(Ut&&(Et.boundingSphere!==void 0?(Et.boundingSphere===null&&Et.computeBoundingSphere(),ln.copy(Et.boundingSphere.center)):(hn.boundingSphere===null&&hn.computeBoundingSphere(),ln.copy(hn.boundingSphere.center)),ln.applyMatrix4(Et.matrixWorld).applyMatrix4(Wt)),Array.isArray(gn)){const vn=hn.groups;for(let _n=0,yn=vn.length;_n<yn;_n++){const xn=vn[_n],Fn=gn[xn.materialIndex];Fn&&Fn.visible&&at.push(Et,hn,Fn,Ot,ln.z,xn)}}else gn.visible&&at.push(Et,hn,gn,Ot,ln.z,null)}}const en=Et.children;for(let hn=0,gn=en.length;hn<gn;hn++)zn(en[hn],Dt,Ot,Ut)}function Wn(Et,Dt,Ot,Ut){const Nt=Et.opaque,en=Et.transmissive,hn=Et.transparent;lt.setupLightsView(Ot),It===!0&&$t.setGlobalState(nt.clippingPlanes,Ot),en.length>0&&qn(Nt,en,Dt,Ot),Ut&&cn.viewport(gt.copy(Ut)),Nt.length>0&&Kn(Nt,Dt,Ot),en.length>0&&Kn(en,Dt,Ot),hn.length>0&&Kn(hn,Dt,Ot),cn.buffers.depth.setTest(!0),cn.buffers.depth.setMask(!0),cn.buffers.color.setMask(!0),cn.setPolygonOffset(!1)}function qn(Et,Dt,Ot,Ut){if((Ot.isScene===!0?Ot.overrideMaterial:null)!==null)return;if(lt.state.transmissionRenderTarget===null){lt.state.transmissionRenderTarget=new WebGLRenderTarget(1,1,{generateMipmaps:!0,type:Jt.has("EXT_color_buffer_half_float")||Jt.has("EXT_color_buffer_float")?HalfFloatType:UnsignedByteType,minFilter:LinearMipmapLinearFilter,samples:4,stencilBuffer:d});const _n=bt.get(lt.state.transmissionRenderTarget);_n.__isTransmissionRenderTarget=!0}const en=lt.state.transmissionRenderTarget;nt.getDrawingBufferSize(Kt),en.setSize(Kt.x,Kt.y);const hn=nt.getRenderTarget();nt.setRenderTarget(en),nt.getClearColor(Tt),Rt=nt.getClearAlpha(),Rt<1&&nt.setClearColor(16777215,.5),nt.clear();const gn=nt.toneMapping;nt.toneMapping=NoToneMapping,Kn(Et,Ot,Ut),xt.updateMultisampleRenderTarget(en),xt.updateRenderTargetMipmap(en);let vn=!1;for(let _n=0,yn=Dt.length;_n<yn;_n++){const xn=Dt[_n],Fn=xn.object,Gn=xn.geometry,Un=xn.material,jn=xn.group;if(Un.side===DoubleSide&&Fn.layers.test(Ut.layers)){const Dn=Un.side;Un.side=BackSide,Un.needsUpdate=!0,nr(Fn,Ot,Ut,Gn,Un,jn),Un.side=Dn,Un.needsUpdate=!0,vn=!0}}vn===!0&&(xt.updateMultisampleRenderTarget(en),xt.updateRenderTargetMipmap(en)),nt.setRenderTarget(hn),nt.setClearColor(Tt,Rt),nt.toneMapping=gn}function Kn(Et,Dt,Ot){const Ut=Dt.isScene===!0?Dt.overrideMaterial:null;for(let Nt=0,en=Et.length;Nt<en;Nt++){const hn=Et[Nt],gn=hn.object,vn=hn.geometry,_n=Ut===null?hn.material:Ut,yn=hn.group;gn.layers.test(Ot.layers)&&nr(gn,Dt,Ot,vn,_n,yn)}}function nr(Et,Dt,Ot,Ut,Nt,en){Et.onBeforeRender(nt,Dt,Ot,Ut,Nt,en),Et.modelViewMatrix.multiplyMatrices(Ot.matrixWorldInverse,Et.matrixWorld),Et.normalMatrix.getNormalMatrix(Et.modelViewMatrix),Nt.onBeforeRender(nt,Dt,Ot,Ut,Et,en),Nt.transparent===!0&&Nt.side===DoubleSide&&Nt.forceSinglePass===!1?(Nt.side=BackSide,Nt.needsUpdate=!0,nt.renderBufferDirect(Ot,Dt,Ut,Nt,Et,en),Nt.side=FrontSide,Nt.needsUpdate=!0,nt.renderBufferDirect(Ot,Dt,Ut,Nt,Et,en),Nt.side=DoubleSide):nt.renderBufferDirect(Ot,Dt,Ut,Nt,Et,en),Et.onAfterRender(nt,Dt,Ot,Ut,Nt,en)}function Zn(Et,Dt,Ot){Dt.isScene!==!0&&(Dt=fn);const Ut=bt.get(Et),Nt=lt.state.lights,en=lt.state.shadowsArray,hn=Nt.state.version,gn=Yt.getParameters(Et,Nt.state,en,Dt,Ot),vn=Yt.getProgramCacheKey(gn);let _n=Ut.programs;Ut.environment=Et.isMeshStandardMaterial?Dt.environment:null,Ut.fog=Dt.fog,Ut.envMap=(Et.isMeshStandardMaterial?Gt:Ft).get(Et.envMap||Ut.environment),Ut.envMapRotation=Ut.environment!==null&&Et.envMap===null?Dt.environmentRotation:Et.envMapRotation,_n===void 0&&(Et.addEventListener("dispose",tn),_n=new Map,Ut.programs=_n);let yn=_n.get(vn);if(yn!==void 0){if(Ut.currentProgram===yn&&Ut.lightsStateVersion===hn)return ir(Et,gn),yn}else gn.uniforms=Yt.getUniforms(Et),Et.onBuild(Ot,gn,nt),Et.onBeforeCompile(gn,nt),yn=Yt.acquireProgram(gn,vn),_n.set(vn,yn),Ut.uniforms=gn.uniforms;const xn=Ut.uniforms;return(!Et.isShaderMaterial&&!Et.isRawShaderMaterial||Et.clipping===!0)&&(xn.clippingPlanes=$t.uniform),ir(Et,gn),Ut.needsLights=cr(Et),Ut.lightsStateVersion=hn,Ut.needsLights&&(xn.ambientLightColor.value=Nt.state.ambient,xn.lightProbe.value=Nt.state.probe,xn.directionalLights.value=Nt.state.directional,xn.directionalLightShadows.value=Nt.state.directionalShadow,xn.spotLights.value=Nt.state.spot,xn.spotLightShadows.value=Nt.state.spotShadow,xn.rectAreaLights.value=Nt.state.rectArea,xn.ltc_1.value=Nt.state.rectAreaLTC1,xn.ltc_2.value=Nt.state.rectAreaLTC2,xn.pointLights.value=Nt.state.point,xn.pointLightShadows.value=Nt.state.pointShadow,xn.hemisphereLights.value=Nt.state.hemi,xn.directionalShadowMap.value=Nt.state.directionalShadowMap,xn.directionalShadowMatrix.value=Nt.state.directionalShadowMatrix,xn.spotShadowMap.value=Nt.state.spotShadowMap,xn.spotLightMatrix.value=Nt.state.spotLightMatrix,xn.spotLightMap.value=Nt.state.spotLightMap,xn.pointShadowMap.value=Nt.state.pointShadowMap,xn.pointShadowMatrix.value=Nt.state.pointShadowMatrix),Ut.currentProgram=yn,Ut.uniformsList=null,yn}function rr(Et){if(Et.uniformsList===null){const Dt=Et.currentProgram.getUniforms();Et.uniformsList=WebGLUniforms.seqWithValue(Dt.seq,Et.uniforms)}return Et.uniformsList}function ir(Et,Dt){const Ot=bt.get(Et);Ot.outputColorSpace=Dt.outputColorSpace,Ot.batching=Dt.batching,Ot.instancing=Dt.instancing,Ot.instancingColor=Dt.instancingColor,Ot.instancingMorph=Dt.instancingMorph,Ot.skinning=Dt.skinning,Ot.morphTargets=Dt.morphTargets,Ot.morphNormals=Dt.morphNormals,Ot.morphColors=Dt.morphColors,Ot.morphTargetsCount=Dt.morphTargetsCount,Ot.numClippingPlanes=Dt.numClippingPlanes,Ot.numIntersection=Dt.numClipIntersection,Ot.vertexAlphas=Dt.vertexAlphas,Ot.vertexTangents=Dt.vertexTangents,Ot.toneMapping=Dt.toneMapping}function or(Et,Dt,Ot,Ut,Nt){Dt.isScene!==!0&&(Dt=fn),xt.resetTextureUnits();const en=Dt.fog,hn=Ut.isMeshStandardMaterial?Dt.environment:null,gn=pt===null?nt.outputColorSpace:pt.isXRRenderTarget===!0?pt.texture.colorSpace:LinearSRGBColorSpace,vn=(Ut.isMeshStandardMaterial?Gt:Ft).get(Ut.envMap||hn),_n=Ut.vertexColors===!0&&!!Ot.attributes.color&&Ot.attributes.color.itemSize===4,yn=!!Ot.attributes.tangent&&(!!Ut.normalMap||Ut.anisotropy>0),xn=!!Ot.morphAttributes.position,Fn=!!Ot.morphAttributes.normal,Gn=!!Ot.morphAttributes.color;let Un=NoToneMapping;Ut.toneMapped&&(pt===null||pt.isXRRenderTarget===!0)&&(Un=nt.toneMapping);const jn=Ot.morphAttributes.position||Ot.morphAttributes.normal||Ot.morphAttributes.color,Dn=jn!==void 0?jn.length:0,Sn=bt.get(Ut),Jn=lt.state.lights;if(It===!0&&(Vt===!0||Et!==vt)){const Hn=Et===vt&&Ut.id===yt;$t.setState(Ut,Et,Hn)}let Ln=!1;Ut.version===Sn.__version?(Sn.needsLights&&Sn.lightsStateVersion!==Jn.state.version||Sn.outputColorSpace!==gn||Nt.isBatchedMesh&&Sn.batching===!1||!Nt.isBatchedMesh&&Sn.batching===!0||Nt.isInstancedMesh&&Sn.instancing===!1||!Nt.isInstancedMesh&&Sn.instancing===!0||Nt.isSkinnedMesh&&Sn.skinning===!1||!Nt.isSkinnedMesh&&Sn.skinning===!0||Nt.isInstancedMesh&&Sn.instancingColor===!0&&Nt.instanceColor===null||Nt.isInstancedMesh&&Sn.instancingColor===!1&&Nt.instanceColor!==null||Nt.isInstancedMesh&&Sn.instancingMorph===!0&&Nt.morphTexture===null||Nt.isInstancedMesh&&Sn.instancingMorph===!1&&Nt.morphTexture!==null||Sn.envMap!==vn||Ut.fog===!0&&Sn.fog!==en||Sn.numClippingPlanes!==void 0&&(Sn.numClippingPlanes!==$t.numPlanes||Sn.numIntersection!==$t.numIntersection)||Sn.vertexAlphas!==_n||Sn.vertexTangents!==yn||Sn.morphTargets!==xn||Sn.morphNormals!==Fn||Sn.morphColors!==Gn||Sn.toneMapping!==Un||Sn.morphTargetsCount!==Dn)&&(Ln=!0):(Ln=!0,Sn.__version=Ut.version);let Xn=Sn.currentProgram;Ln===!0&&(Xn=Zn(Ut,Dt,Nt));let sr=!1,Qn=!1,$n=!1;const Bn=Xn.getUniforms(),Yn=Sn.uniforms;if(cn.useProgram(Xn.program)&&(sr=!0,Qn=!0,$n=!0),Ut.id!==yt&&(yt=Ut.id,Qn=!0),sr||vt!==Et){Bn.setValue(Lt,"projectionMatrix",Et.projectionMatrix),Bn.setValue(Lt,"viewMatrix",Et.matrixWorldInverse);const Hn=Bn.map.cameraPosition;Hn!==void 0&&Hn.setValue(Lt,ln.setFromMatrixPosition(Et.matrixWorld)),Qt.logarithmicDepthBuffer&&Bn.setValue(Lt,"logDepthBufFC",2/(Math.log(Et.far+1)/Math.LN2)),(Ut.isMeshPhongMaterial||Ut.isMeshToonMaterial||Ut.isMeshLambertMaterial||Ut.isMeshBasicMaterial||Ut.isMeshStandardMaterial||Ut.isShaderMaterial)&&Bn.setValue(Lt,"isOrthographic",Et.isOrthographicCamera===!0),vt!==Et&&(vt=Et,Qn=!0,$n=!0)}if(Nt.isSkinnedMesh){Bn.setOptional(Lt,Nt,"bindMatrix"),Bn.setOptional(Lt,Nt,"bindMatrixInverse");const Hn=Nt.skeleton;Hn&&(Hn.boneTexture===null&&Hn.computeBoneTexture(),Bn.setValue(Lt,"boneTexture",Hn.boneTexture,xt))}Nt.isBatchedMesh&&(Bn.setOptional(Lt,Nt,"batchingTexture"),Bn.setValue(Lt,"batchingTexture",Nt._matricesTexture,xt));const er=Ot.morphAttributes;if((er.position!==void 0||er.normal!==void 0||er.color!==void 0)&&an.update(Nt,Ot,Xn),(Qn||Sn.receiveShadow!==Nt.receiveShadow)&&(Sn.receiveShadow=Nt.receiveShadow,Bn.setValue(Lt,"receiveShadow",Nt.receiveShadow)),Ut.isMeshGouraudMaterial&&Ut.envMap!==null&&(Yn.envMap.value=vn,Yn.flipEnvMap.value=vn.isCubeTexture&&vn.isRenderTargetTexture===!1?-1:1),Ut.isMeshStandardMaterial&&Ut.envMap===null&&Dt.environment!==null&&(Yn.envMapIntensity.value=Dt.environmentIntensity),Qn&&(Bn.setValue(Lt,"toneMappingExposure",nt.toneMappingExposure),Sn.needsLights&&lr(Yn,$n),en&&Ut.fog===!0&&rn.refreshFogUniforms(Yn,en),rn.refreshMaterialUniforms(Yn,Ut,St,_t,lt.state.transmissionRenderTarget),WebGLUniforms.upload(Lt,rr(Sn),Yn,xt)),Ut.isShaderMaterial&&Ut.uniformsNeedUpdate===!0&&(WebGLUniforms.upload(Lt,rr(Sn),Yn,xt),Ut.uniformsNeedUpdate=!1),Ut.isSpriteMaterial&&Bn.setValue(Lt,"center",Nt.center),Bn.setValue(Lt,"modelViewMatrix",Nt.modelViewMatrix),Bn.setValue(Lt,"normalMatrix",Nt.normalMatrix),Bn.setValue(Lt,"modelMatrix",Nt.matrixWorld),Ut.isShaderMaterial||Ut.isRawShaderMaterial){const Hn=Ut.uniformsGroups;for(let tr=0,ur=Hn.length;tr<ur;tr++){const ar=Hn[tr];wn.update(ar,Xn),wn.bind(ar,Xn)}}return Xn}function lr(Et,Dt){Et.ambientLightColor.needsUpdate=Dt,Et.lightProbe.needsUpdate=Dt,Et.directionalLights.needsUpdate=Dt,Et.directionalLightShadows.needsUpdate=Dt,Et.pointLights.needsUpdate=Dt,Et.pointLightShadows.needsUpdate=Dt,Et.spotLights.needsUpdate=Dt,Et.spotLightShadows.needsUpdate=Dt,Et.rectAreaLights.needsUpdate=Dt,Et.hemisphereLights.needsUpdate=Dt}function cr(Et){return Et.isMeshLambertMaterial||Et.isMeshToonMaterial||Et.isMeshPhongMaterial||Et.isMeshStandardMaterial||Et.isShadowMaterial||Et.isShaderMaterial&&Et.lights===!0}this.getActiveCubeFace=function(){return ht},this.getActiveMipmapLevel=function(){return ft},this.getRenderTarget=function(){return pt},this.setRenderTargetTextures=function(Et,Dt,Ot){bt.get(Et.texture).__webglTexture=Dt,bt.get(Et.depthTexture).__webglTexture=Ot;const Ut=bt.get(Et);Ut.__hasExternalTextures=!0,Ut.__autoAllocateDepthBuffer=Ot===void 0,Ut.__autoAllocateDepthBuffer||Jt.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),Ut.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(Et,Dt){const Ot=bt.get(Et);Ot.__webglFramebuffer=Dt,Ot.__useDefaultFramebuffer=Dt===void 0},this.setRenderTarget=function(Et,Dt=0,Ot=0){pt=Et,ht=Dt,ft=Ot;let Ut=!0,Nt=null,en=!1,hn=!1;if(Et){const vn=bt.get(Et);vn.__useDefaultFramebuffer!==void 0?(cn.bindFramebuffer(Lt.FRAMEBUFFER,null),Ut=!1):vn.__webglFramebuffer===void 0?xt.setupRenderTarget(Et):vn.__hasExternalTextures&&xt.rebindTextures(Et,bt.get(Et.texture).__webglTexture,bt.get(Et.depthTexture).__webglTexture);const _n=Et.texture;(_n.isData3DTexture||_n.isDataArrayTexture||_n.isCompressedArrayTexture)&&(hn=!0);const yn=bt.get(Et).__webglFramebuffer;Et.isWebGLCubeRenderTarget?(Array.isArray(yn[Dt])?Nt=yn[Dt][Ot]:Nt=yn[Dt],en=!0):Et.samples>0&&xt.useMultisampledRTT(Et)===!1?Nt=bt.get(Et).__webglMultisampledFramebuffer:Array.isArray(yn)?Nt=yn[Ot]:Nt=yn,gt.copy(Et.viewport),Ct.copy(Et.scissor),Pt=Et.scissorTest}else gt.copy(Mt).multiplyScalar(St).floor(),Ct.copy(At).multiplyScalar(St).floor(),Pt=Bt;if(cn.bindFramebuffer(Lt.FRAMEBUFFER,Nt)&&Ut&&cn.drawBuffers(Et,Nt),cn.viewport(gt),cn.scissor(Ct),cn.setScissorTest(Pt),en){const vn=bt.get(Et.texture);Lt.framebufferTexture2D(Lt.FRAMEBUFFER,Lt.COLOR_ATTACHMENT0,Lt.TEXTURE_CUBE_MAP_POSITIVE_X+Dt,vn.__webglTexture,Ot)}else if(hn){const vn=bt.get(Et.texture),_n=Dt||0;Lt.framebufferTextureLayer(Lt.FRAMEBUFFER,Lt.COLOR_ATTACHMENT0,vn.__webglTexture,Ot||0,_n)}yt=-1},this.readRenderTargetPixels=function(Et,Dt,Ot,Ut,Nt,en,hn){if(!(Et&&Et.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let gn=bt.get(Et).__webglFramebuffer;if(Et.isWebGLCubeRenderTarget&&hn!==void 0&&(gn=gn[hn]),gn){cn.bindFramebuffer(Lt.FRAMEBUFFER,gn);try{const vn=Et.texture,_n=vn.format,yn=vn.type;if(_n!==RGBAFormat&&Pn.convert(_n)!==Lt.getParameter(Lt.IMPLEMENTATION_COLOR_READ_FORMAT)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}const xn=yn===HalfFloatType&&(Jt.has("EXT_color_buffer_half_float")||Jt.has("EXT_color_buffer_float"));if(yn!==UnsignedByteType&&Pn.convert(yn)!==Lt.getParameter(Lt.IMPLEMENTATION_COLOR_READ_TYPE)&&yn!==FloatType&&!xn){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}Dt>=0&&Dt<=Et.width-Ut&&Ot>=0&&Ot<=Et.height-Nt&&Lt.readPixels(Dt,Ot,Ut,Nt,Pn.convert(_n),Pn.convert(yn),en)}finally{const vn=pt!==null?bt.get(pt).__webglFramebuffer:null;cn.bindFramebuffer(Lt.FRAMEBUFFER,vn)}}},this.copyFramebufferToTexture=function(Et,Dt,Ot=0){const Ut=Math.pow(2,-Ot),Nt=Math.floor(Dt.image.width*Ut),en=Math.floor(Dt.image.height*Ut);xt.setTexture2D(Dt,0),Lt.copyTexSubImage2D(Lt.TEXTURE_2D,Ot,0,0,Et.x,Et.y,Nt,en),cn.unbindTexture()},this.copyTextureToTexture=function(Et,Dt,Ot,Ut=0){const Nt=Dt.image.width,en=Dt.image.height,hn=Pn.convert(Ot.format),gn=Pn.convert(Ot.type);xt.setTexture2D(Ot,0),Lt.pixelStorei(Lt.UNPACK_FLIP_Y_WEBGL,Ot.flipY),Lt.pixelStorei(Lt.UNPACK_PREMULTIPLY_ALPHA_WEBGL,Ot.premultiplyAlpha),Lt.pixelStorei(Lt.UNPACK_ALIGNMENT,Ot.unpackAlignment),Dt.isDataTexture?Lt.texSubImage2D(Lt.TEXTURE_2D,Ut,Et.x,Et.y,Nt,en,hn,gn,Dt.image.data):Dt.isCompressedTexture?Lt.compressedTexSubImage2D(Lt.TEXTURE_2D,Ut,Et.x,Et.y,Dt.mipmaps[0].width,Dt.mipmaps[0].height,hn,Dt.mipmaps[0].data):Lt.texSubImage2D(Lt.TEXTURE_2D,Ut,Et.x,Et.y,hn,gn,Dt.image),Ut===0&&Ot.generateMipmaps&&Lt.generateMipmap(Lt.TEXTURE_2D),cn.unbindTexture()},this.copyTextureToTexture3D=function(Et,Dt,Ot,Ut,Nt=0){const en=Math.round(Et.max.x-Et.min.x),hn=Math.round(Et.max.y-Et.min.y),gn=Et.max.z-Et.min.z+1,vn=Pn.convert(Ut.format),_n=Pn.convert(Ut.type);let yn;if(Ut.isData3DTexture)xt.setTexture3D(Ut,0),yn=Lt.TEXTURE_3D;else if(Ut.isDataArrayTexture||Ut.isCompressedArrayTexture)xt.setTexture2DArray(Ut,0),yn=Lt.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}Lt.pixelStorei(Lt.UNPACK_FLIP_Y_WEBGL,Ut.flipY),Lt.pixelStorei(Lt.UNPACK_PREMULTIPLY_ALPHA_WEBGL,Ut.premultiplyAlpha),Lt.pixelStorei(Lt.UNPACK_ALIGNMENT,Ut.unpackAlignment);const xn=Lt.getParameter(Lt.UNPACK_ROW_LENGTH),Fn=Lt.getParameter(Lt.UNPACK_IMAGE_HEIGHT),Gn=Lt.getParameter(Lt.UNPACK_SKIP_PIXELS),Un=Lt.getParameter(Lt.UNPACK_SKIP_ROWS),jn=Lt.getParameter(Lt.UNPACK_SKIP_IMAGES),Dn=Ot.isCompressedTexture?Ot.mipmaps[Nt]:Ot.image;Lt.pixelStorei(Lt.UNPACK_ROW_LENGTH,Dn.width),Lt.pixelStorei(Lt.UNPACK_IMAGE_HEIGHT,Dn.height),Lt.pixelStorei(Lt.UNPACK_SKIP_PIXELS,Et.min.x),Lt.pixelStorei(Lt.UNPACK_SKIP_ROWS,Et.min.y),Lt.pixelStorei(Lt.UNPACK_SKIP_IMAGES,Et.min.z),Ot.isDataTexture||Ot.isData3DTexture?Lt.texSubImage3D(yn,Nt,Dt.x,Dt.y,Dt.z,en,hn,gn,vn,_n,Dn.data):Ut.isCompressedArrayTexture?Lt.compressedTexSubImage3D(yn,Nt,Dt.x,Dt.y,Dt.z,en,hn,gn,vn,Dn.data):Lt.texSubImage3D(yn,Nt,Dt.x,Dt.y,Dt.z,en,hn,gn,vn,_n,Dn),Lt.pixelStorei(Lt.UNPACK_ROW_LENGTH,xn),Lt.pixelStorei(Lt.UNPACK_IMAGE_HEIGHT,Fn),Lt.pixelStorei(Lt.UNPACK_SKIP_PIXELS,Gn),Lt.pixelStorei(Lt.UNPACK_SKIP_ROWS,Un),Lt.pixelStorei(Lt.UNPACK_SKIP_IMAGES,jn),Nt===0&&Ut.generateMipmaps&&Lt.generateMipmap(yn),cn.unbindTexture()},this.initTexture=function(Et){Et.isCubeTexture?xt.setTextureCube(Et,0):Et.isData3DTexture?xt.setTexture3D(Et,0):Et.isDataArrayTexture||Et.isCompressedArrayTexture?xt.setTexture2DArray(Et,0):xt.setTexture2D(Et,0),cn.unbindTexture()},this.resetState=function(){ht=0,ft=0,pt=null,cn.reset(),Cn.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return WebGLCoordinateSystem}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const a=this.getContext();a.drawingBufferColorSpace=e===DisplayP3ColorSpace?"display-p3":"srgb",a.unpackColorSpace=ColorManagement.workingColorSpace===LinearDisplayP3ColorSpace?"display-p3":"srgb"}get useLegacyLights(){return console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights}set useLegacyLights(e){console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights=e}}class Scene extends Object3D{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Euler,this.environmentIntensity=1,this.environmentRotation=new Euler,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,a){return super.copy(e,a),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const a=super.toJSON(e);return this.fog!==null&&(a.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(a.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(a.object.backgroundIntensity=this.backgroundIntensity),a.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(a.object.environmentIntensity=this.environmentIntensity),a.object.environmentRotation=this.environmentRotation.toArray(),a}}class MeshStandardMaterial extends Material{constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new Color(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Color(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=TangentSpaceNormalMap,this.normalScale=new Vector2(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Euler,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class MeshPhongMaterial extends Material{constructor(e){super(),this.isMeshPhongMaterial=!0,this.type="MeshPhongMaterial",this.color=new Color(16777215),this.specular=new Color(1118481),this.shininess=30,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Color(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=TangentSpaceNormalMap,this.normalScale=new Vector2(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Euler,this.combine=MultiplyOperation,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.specular.copy(e.specular),this.shininess=e.shininess,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class Light extends Object3D{constructor(e,a=1){super(),this.isLight=!0,this.type="Light",this.color=new Color(e),this.intensity=a}dispose(){}copy(e,a){return super.copy(e,a),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const a=super.toJSON(e);return a.object.color=this.color.getHex(),a.object.intensity=this.intensity,this.groundColor!==void 0&&(a.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(a.object.distance=this.distance),this.angle!==void 0&&(a.object.angle=this.angle),this.decay!==void 0&&(a.object.decay=this.decay),this.penumbra!==void 0&&(a.object.penumbra=this.penumbra),this.shadow!==void 0&&(a.object.shadow=this.shadow.toJSON()),a}}const _projScreenMatrix$1=new Matrix4,_lightPositionWorld$1=new Vector3,_lookTarget$1=new Vector3;class LightShadow{constructor(e){this.camera=e,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Vector2(512,512),this.map=null,this.mapPass=null,this.matrix=new Matrix4,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Frustum,this._frameExtents=new Vector2(1,1),this._viewportCount=1,this._viewports=[new Vector4(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const a=this.camera,o=this.matrix;_lightPositionWorld$1.setFromMatrixPosition(e.matrixWorld),a.position.copy(_lightPositionWorld$1),_lookTarget$1.setFromMatrixPosition(e.target.matrixWorld),a.lookAt(_lookTarget$1),a.updateMatrixWorld(),_projScreenMatrix$1.multiplyMatrices(a.projectionMatrix,a.matrixWorldInverse),this._frustum.setFromProjectionMatrix(_projScreenMatrix$1),o.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),o.multiply(_projScreenMatrix$1)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class DirectionalLightShadow extends LightShadow{constructor(){super(new OrthographicCamera(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class DirectionalLight extends Light{constructor(e,a){super(e,a),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Object3D.DEFAULT_UP),this.updateMatrix(),this.target=new Object3D,this.shadow=new DirectionalLightShadow}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class AmbientLight extends Light{constructor(e,a){super(e,a),this.isAmbientLight=!0,this.type="AmbientLight"}}class Spherical{constructor(e=1,a=0,o=0){return this.radius=e,this.phi=a,this.theta=o,this}set(e,a,o){return this.radius=e,this.phi=a,this.theta=o,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,a,o){return this.radius=Math.sqrt(e*e+a*a+o*o),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,o),this.phi=Math.acos(clamp(a/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:REVISION}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=REVISION);const _changeEvent={type:"change"},_startEvent={type:"start"},_endEvent={type:"end"},_ray=new Ray,_plane=new Plane,TILT_LIMIT=Math.cos(70*MathUtils.DEG2RAD);class OrbitControls extends EventDispatcher{constructor(e,a){super(),this.object=e,this.domElement=a,this.domElement.style.touchAction="none",this.enabled=!0,this.target=new Vector3,this.cursor=new Vector3,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:MOUSE.ROTATE,MIDDLE:MOUSE.DOLLY,RIGHT:MOUSE.PAN},this.touches={ONE:TOUCH.ROTATE,TWO:TOUCH.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this.getPolarAngle=function(){return _.phi},this.getAzimuthalAngle=function(){return _.theta},this.getDistance=function(){return this.object.position.distanceTo(this.target)},this.listenToKeyEvents=function(mt){mt.addEventListener("keydown",$t),this._domElementKeyEvents=mt},this.stopListenToKeyEvents=function(){this._domElementKeyEvents.removeEventListener("keydown",$t),this._domElementKeyEvents=null},this.saveState=function(){o.target0.copy(o.target),o.position0.copy(o.object.position),o.zoom0=o.object.zoom},this.reset=function(){o.target.copy(o.target0),o.object.position.copy(o.position0),o.object.zoom=o.zoom0,o.object.updateProjectionMatrix(),o.dispatchEvent(_changeEvent),o.update(),d=c.NONE},this.update=function(){const mt=new Vector3,kt=new Quaternion().setFromUnitVectors(e.up,new Vector3(0,1,0)),Ht=kt.clone().invert(),Zt=new Vector3,tn=new Quaternion,bn=new Vector3,Mn=2*Math.PI;return function(On=null){const Rn=o.object.position;mt.copy(Rn).sub(o.target),mt.applyQuaternion(kt),_.setFromVector3(mt),o.autoRotate&&d===c.NONE&&Pt(gt(On)),o.enableDamping?(_.theta+=b.theta*o.dampingFactor,_.phi+=b.phi*o.dampingFactor):(_.theta+=b.theta,_.phi+=b.phi);let kn=o.minAzimuthAngle,Nn=o.maxAzimuthAngle;isFinite(kn)&&isFinite(Nn)&&(kn<-Math.PI?kn+=Mn:kn>Math.PI&&(kn-=Mn),Nn<-Math.PI?Nn+=Mn:Nn>Math.PI&&(Nn-=Mn),kn<=Nn?_.theta=Math.max(kn,Math.min(Nn,_.theta)):_.theta=_.theta>(kn+Nn)/2?Math.max(kn,_.theta):Math.min(Nn,_.theta)),_.phi=Math.max(o.minPolarAngle,Math.min(o.maxPolarAngle,_.phi)),_.makeSafe(),o.enableDamping===!0?o.target.addScaledVector(tt,o.dampingFactor):o.target.add(tt),o.target.sub(o.cursor),o.target.clampLength(o.minTargetRadius,o.maxTargetRadius),o.target.add(o.cursor);let Vn=!1;if(o.zoomToCursor&&ft||o.object.isOrthographicCamera)_.radius=Mt(_.radius);else{const zn=_.radius;_.radius=Mt(_.radius*$),Vn=zn!=_.radius}if(mt.setFromSpherical(_),mt.applyQuaternion(Ht),Rn.copy(o.target).add(mt),o.object.lookAt(o.target),o.enableDamping===!0?(b.theta*=1-o.dampingFactor,b.phi*=1-o.dampingFactor,tt.multiplyScalar(1-o.dampingFactor)):(b.set(0,0,0),tt.set(0,0,0)),o.zoomToCursor&&ft){let zn=null;if(o.object.isPerspectiveCamera){const Wn=mt.length();zn=Mt(Wn*$);const qn=Wn-zn;o.object.position.addScaledVector(ct,qn),o.object.updateMatrixWorld(),Vn=!!qn}else if(o.object.isOrthographicCamera){const Wn=new Vector3(ht.x,ht.y,0);Wn.unproject(o.object);const qn=o.object.zoom;o.object.zoom=Math.max(o.minZoom,Math.min(o.maxZoom,o.object.zoom/$)),o.object.updateProjectionMatrix(),Vn=qn!==o.object.zoom;const Kn=new Vector3(ht.x,ht.y,0);Kn.unproject(o.object),o.object.position.sub(Kn).add(Wn),o.object.updateMatrixWorld(),zn=mt.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),o.zoomToCursor=!1;zn!==null&&(this.screenSpacePanning?o.target.set(0,0,-1).transformDirection(o.object.matrix).multiplyScalar(zn).add(o.object.position):(_ray.origin.copy(o.object.position),_ray.direction.set(0,0,-1).transformDirection(o.object.matrix),Math.abs(o.object.up.dot(_ray.direction))<TILT_LIMIT?e.lookAt(o.target):(_plane.setFromNormalAndCoplanarPoint(o.object.up,o.target),_ray.intersectPlane(_plane,o.target))))}else if(o.object.isOrthographicCamera){const zn=o.object.zoom;o.object.zoom=Math.max(o.minZoom,Math.min(o.maxZoom,o.object.zoom/$)),zn!==o.object.zoom&&(o.object.updateProjectionMatrix(),Vn=!0)}return $=1,ft=!1,Vn||Zt.distanceToSquared(o.object.position)>g||8*(1-tn.dot(o.object.quaternion))>g||bn.distanceToSquared(o.target)>g?(o.dispatchEvent(_changeEvent),Zt.copy(o.object.position),tn.copy(o.object.quaternion),bn.copy(o.target),!0):!1}}(),this.dispose=function(){o.domElement.removeEventListener("contextmenu",an),o.domElement.removeEventListener("pointerdown",Ft),o.domElement.removeEventListener("pointercancel",zt),o.domElement.removeEventListener("wheel",Yt),o.domElement.removeEventListener("pointermove",Gt),o.domElement.removeEventListener("pointerup",zt),o.domElement.getRootNode().removeEventListener("keydown",sn,{capture:!0}),o._domElementKeyEvents!==null&&(o._domElementKeyEvents.removeEventListener("keydown",$t),o._domElementKeyEvents=null)};const o=this,c={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6};let d=c.NONE;const g=1e-6,_=new Spherical,b=new Spherical;let $=1;const tt=new Vector3,rt=new Vector2,et=new Vector2,st=new Vector2,ot=new Vector2,at=new Vector2,lt=new Vector2,_e=new Vector2,it=new Vector2,nt=new Vector2,ct=new Vector3,ht=new Vector2;let ft=!1;const pt=[],yt={};let vt=!1;function gt(mt){return mt!==null?2*Math.PI/60*o.autoRotateSpeed*mt:2*Math.PI/60/60*o.autoRotateSpeed}function Ct(mt){const kt=Math.abs(mt*.01);return Math.pow(.95,o.zoomSpeed*kt)}function Pt(mt){b.theta-=mt}function Tt(mt){b.phi-=mt}const Rt=function(){const mt=new Vector3;return function(Ht,Zt){mt.setFromMatrixColumn(Zt,0),mt.multiplyScalar(-Ht),tt.add(mt)}}(),wt=function(){const mt=new Vector3;return function(Ht,Zt){o.screenSpacePanning===!0?mt.setFromMatrixColumn(Zt,1):(mt.setFromMatrixColumn(Zt,0),mt.crossVectors(o.object.up,mt)),mt.multiplyScalar(Ht),tt.add(mt)}}(),_t=function(){const mt=new Vector3;return function(Ht,Zt){const tn=o.domElement;if(o.object.isPerspectiveCamera){const bn=o.object.position;mt.copy(bn).sub(o.target);let Mn=mt.length();Mn*=Math.tan(o.object.fov/2*Math.PI/180),Rt(2*Ht*Mn/tn.clientHeight,o.object.matrix),wt(2*Zt*Mn/tn.clientHeight,o.object.matrix)}else o.object.isOrthographicCamera?(Rt(Ht*(o.object.right-o.object.left)/o.object.zoom/tn.clientWidth,o.object.matrix),wt(Zt*(o.object.top-o.object.bottom)/o.object.zoom/tn.clientHeight,o.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),o.enablePan=!1)}}();function St(mt){o.object.isPerspectiveCamera||o.object.isOrthographicCamera?$/=mt:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),o.enableZoom=!1)}function ut(mt){o.object.isPerspectiveCamera||o.object.isOrthographicCamera?$*=mt:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),o.enableZoom=!1)}function dt(mt,kt){if(!o.zoomToCursor)return;ft=!0;const Ht=o.domElement.getBoundingClientRect(),Zt=mt-Ht.left,tn=kt-Ht.top,bn=Ht.width,Mn=Ht.height;ht.x=Zt/bn*2-1,ht.y=-(tn/Mn)*2+1,ct.set(ht.x,ht.y,1).unproject(o.object).sub(o.object.position).normalize()}function Mt(mt){return Math.max(o.minDistance,Math.min(o.maxDistance,mt))}function At(mt){rt.set(mt.clientX,mt.clientY)}function Bt(mt){dt(mt.clientX,mt.clientX),_e.set(mt.clientX,mt.clientY)}function Xt(mt){ot.set(mt.clientX,mt.clientY)}function It(mt){et.set(mt.clientX,mt.clientY),st.subVectors(et,rt).multiplyScalar(o.rotateSpeed);const kt=o.domElement;Pt(2*Math.PI*st.x/kt.clientHeight),Tt(2*Math.PI*st.y/kt.clientHeight),rt.copy(et),o.update()}function Vt(mt){it.set(mt.clientX,mt.clientY),nt.subVectors(it,_e),nt.y>0?St(Ct(nt.y)):nt.y<0&&ut(Ct(nt.y)),_e.copy(it),o.update()}function Wt(mt){at.set(mt.clientX,mt.clientY),lt.subVectors(at,ot).multiplyScalar(o.panSpeed),_t(lt.x,lt.y),ot.copy(at),o.update()}function Kt(mt){dt(mt.clientX,mt.clientY),mt.deltaY<0?ut(Ct(mt.deltaY)):mt.deltaY>0&&St(Ct(mt.deltaY)),o.update()}function ln(mt){let kt=!1;switch(mt.code){case o.keys.UP:mt.ctrlKey||mt.metaKey||mt.shiftKey?Tt(2*Math.PI*o.rotateSpeed/o.domElement.clientHeight):_t(0,o.keyPanSpeed),kt=!0;break;case o.keys.BOTTOM:mt.ctrlKey||mt.metaKey||mt.shiftKey?Tt(-2*Math.PI*o.rotateSpeed/o.domElement.clientHeight):_t(0,-o.keyPanSpeed),kt=!0;break;case o.keys.LEFT:mt.ctrlKey||mt.metaKey||mt.shiftKey?Pt(2*Math.PI*o.rotateSpeed/o.domElement.clientHeight):_t(o.keyPanSpeed,0),kt=!0;break;case o.keys.RIGHT:mt.ctrlKey||mt.metaKey||mt.shiftKey?Pt(-2*Math.PI*o.rotateSpeed/o.domElement.clientHeight):_t(-o.keyPanSpeed,0),kt=!0;break}kt&&(mt.preventDefault(),o.update())}function fn(mt){if(pt.length===1)rt.set(mt.pageX,mt.pageY);else{const kt=wn(mt),Ht=.5*(mt.pageX+kt.x),Zt=.5*(mt.pageY+kt.y);rt.set(Ht,Zt)}}function dn(mt){if(pt.length===1)ot.set(mt.pageX,mt.pageY);else{const kt=wn(mt),Ht=.5*(mt.pageX+kt.x),Zt=.5*(mt.pageY+kt.y);ot.set(Ht,Zt)}}function Lt(mt){const kt=wn(mt),Ht=mt.pageX-kt.x,Zt=mt.pageY-kt.y,tn=Math.sqrt(Ht*Ht+Zt*Zt);_e.set(0,tn)}function pn(mt){o.enableZoom&&Lt(mt),o.enablePan&&dn(mt)}function Jt(mt){o.enableZoom&&Lt(mt),o.enableRotate&&fn(mt)}function Qt(mt){if(pt.length==1)et.set(mt.pageX,mt.pageY);else{const Ht=wn(mt),Zt=.5*(mt.pageX+Ht.x),tn=.5*(mt.pageY+Ht.y);et.set(Zt,tn)}st.subVectors(et,rt).multiplyScalar(o.rotateSpeed);const kt=o.domElement;Pt(2*Math.PI*st.x/kt.clientHeight),Tt(2*Math.PI*st.y/kt.clientHeight),rt.copy(et)}function cn(mt){if(pt.length===1)at.set(mt.pageX,mt.pageY);else{const kt=wn(mt),Ht=.5*(mt.pageX+kt.x),Zt=.5*(mt.pageY+kt.y);at.set(Ht,Zt)}lt.subVectors(at,ot).multiplyScalar(o.panSpeed),_t(lt.x,lt.y),ot.copy(at)}function En(mt){const kt=wn(mt),Ht=mt.pageX-kt.x,Zt=mt.pageY-kt.y,tn=Math.sqrt(Ht*Ht+Zt*Zt);it.set(0,tn),nt.set(0,Math.pow(it.y/_e.y,o.zoomSpeed)),St(nt.y),_e.copy(it);const bn=(mt.pageX+kt.x)*.5,Mn=(mt.pageY+kt.y)*.5;dt(bn,Mn)}function bt(mt){o.enableZoom&&En(mt),o.enablePan&&cn(mt)}function xt(mt){o.enableZoom&&En(mt),o.enableRotate&&Qt(mt)}function Ft(mt){o.enabled!==!1&&(pt.length===0&&(o.domElement.setPointerCapture(mt.pointerId),o.domElement.addEventListener("pointermove",Gt),o.domElement.addEventListener("pointerup",zt)),!Pn(mt)&&(An(mt),mt.pointerType==="touch"?mn(mt):jt(mt)))}function Gt(mt){o.enabled!==!1&&(mt.pointerType==="touch"?nn(mt):on(mt))}function zt(mt){switch(Tn(mt),pt.length){case 0:o.domElement.releasePointerCapture(mt.pointerId),o.domElement.removeEventListener("pointermove",Gt),o.domElement.removeEventListener("pointerup",zt),o.dispatchEvent(_endEvent),d=c.NONE;break;case 1:const kt=pt[0],Ht=yt[kt];mn({pointerId:kt,pageX:Ht.x,pageY:Ht.y});break}}function jt(mt){let kt;switch(mt.button){case 0:kt=o.mouseButtons.LEFT;break;case 1:kt=o.mouseButtons.MIDDLE;break;case 2:kt=o.mouseButtons.RIGHT;break;default:kt=-1}switch(kt){case MOUSE.DOLLY:if(o.enableZoom===!1)return;Bt(mt),d=c.DOLLY;break;case MOUSE.ROTATE:if(mt.ctrlKey||mt.metaKey||mt.shiftKey){if(o.enablePan===!1)return;Xt(mt),d=c.PAN}else{if(o.enableRotate===!1)return;At(mt),d=c.ROTATE}break;case MOUSE.PAN:if(mt.ctrlKey||mt.metaKey||mt.shiftKey){if(o.enableRotate===!1)return;At(mt),d=c.ROTATE}else{if(o.enablePan===!1)return;Xt(mt),d=c.PAN}break;default:d=c.NONE}d!==c.NONE&&o.dispatchEvent(_startEvent)}function on(mt){switch(d){case c.ROTATE:if(o.enableRotate===!1)return;It(mt);break;case c.DOLLY:if(o.enableZoom===!1)return;Vt(mt);break;case c.PAN:if(o.enablePan===!1)return;Wt(mt);break}}function Yt(mt){o.enabled===!1||o.enableZoom===!1||d!==c.NONE||(mt.preventDefault(),o.dispatchEvent(_startEvent),Kt(rn(mt)),o.dispatchEvent(_endEvent))}function rn(mt){const kt=mt.deltaMode,Ht={clientX:mt.clientX,clientY:mt.clientY,deltaY:mt.deltaY};switch(kt){case 1:Ht.deltaY*=16;break;case 2:Ht.deltaY*=100;break}return mt.ctrlKey&&!vt&&(Ht.deltaY*=10),Ht}function sn(mt){mt.key==="Control"&&(vt=!0,o.domElement.getRootNode().addEventListener("keyup",qt,{passive:!0,capture:!0}))}function qt(mt){mt.key==="Control"&&(vt=!1,o.domElement.getRootNode().removeEventListener("keyup",qt,{passive:!0,capture:!0}))}function $t(mt){o.enabled===!1||o.enablePan===!1||ln(mt)}function mn(mt){switch(Cn(mt),pt.length){case 1:switch(o.touches.ONE){case TOUCH.ROTATE:if(o.enableRotate===!1)return;fn(mt),d=c.TOUCH_ROTATE;break;case TOUCH.PAN:if(o.enablePan===!1)return;dn(mt),d=c.TOUCH_PAN;break;default:d=c.NONE}break;case 2:switch(o.touches.TWO){case TOUCH.DOLLY_PAN:if(o.enableZoom===!1&&o.enablePan===!1)return;pn(mt),d=c.TOUCH_DOLLY_PAN;break;case TOUCH.DOLLY_ROTATE:if(o.enableZoom===!1&&o.enableRotate===!1)return;Jt(mt),d=c.TOUCH_DOLLY_ROTATE;break;default:d=c.NONE}break;default:d=c.NONE}d!==c.NONE&&o.dispatchEvent(_startEvent)}function nn(mt){switch(Cn(mt),d){case c.TOUCH_ROTATE:if(o.enableRotate===!1)return;Qt(mt),o.update();break;case c.TOUCH_PAN:if(o.enablePan===!1)return;cn(mt),o.update();break;case c.TOUCH_DOLLY_PAN:if(o.enableZoom===!1&&o.enablePan===!1)return;bt(mt),o.update();break;case c.TOUCH_DOLLY_ROTATE:if(o.enableZoom===!1&&o.enableRotate===!1)return;xt(mt),o.update();break;default:d=c.NONE}}function an(mt){o.enabled!==!1&&mt.preventDefault()}function An(mt){pt.push(mt.pointerId)}function Tn(mt){delete yt[mt.pointerId];for(let kt=0;kt<pt.length;kt++)if(pt[kt]==mt.pointerId){pt.splice(kt,1);return}}function Pn(mt){for(let kt=0;kt<pt.length;kt++)if(pt[kt]==mt.pointerId)return!0;return!1}function Cn(mt){let kt=yt[mt.pointerId];kt===void 0&&(kt=new Vector2,yt[mt.pointerId]=kt),kt.set(mt.pageX,mt.pageY)}function wn(mt){const kt=mt.pointerId===pt[0]?pt[1]:pt[0];return yt[kt]}o.domElement.addEventListener("contextmenu",an),o.domElement.addEventListener("pointerdown",Ft),o.domElement.addEventListener("pointercancel",zt),o.domElement.addEventListener("wheel",Yt,{passive:!1}),o.domElement.getRootNode().addEventListener("keydown",sn,{passive:!0,capture:!0}),this.update()}}const GameOfLife3D=()=>{const s=reactExports.useRef(null);return reactExports.useEffect(()=>{const d=new Scene;d.rotation.y=3*Math.PI/2,d.rotation.x=Math.PI/4,d.scale.set(3.25,3.25,3.25);const g=new AmbientLight(16777215,.8);d.add(g);const _=new DirectionalLight(15658751,2);_.position.set(1.5,1,0),d.add(_);const b=new DirectionalLight(15658495,2.5);_.position.set(-3.5,-10,-3.5),d.add(b);const $=new PerspectiveCamera(75,window.innerWidth/window.innerHeight,.1,1e3),tt=new WebGLRenderer({alpha:!0,antialias:!0});tt.setSize(window.innerWidth,window.innerHeight),s.current.appendChild(tt.domElement);const rt=new BoxGeometry(.95,.95,.95),et=new MeshPhongMaterial({color:16777215}),st=new MeshStandardMaterial({color:0,transparent:!0,opacity:0});let ot=Array.from({length:28},()=>Array.from({length:16},()=>Array(16).fill(!1)));const at="0010010010111110110001110000101101010001010111010010011000111101001110011110001110001101111110100001000100101001001111010010110011011001100110111011110100001110100011110011100001111111111001111100010111010111011011111100010101000001111010011111010110000010";ot[27]=at.match(/.{1,16}/g).map(pt=>pt.split("").map(yt=>yt==="1"));const lt=ot.flat(2).map((pt,yt)=>{const vt=Math.floor(yt/256),gt=Math.floor(yt%(16*16)/16),Ct=yt%16,Pt=pt?et:st,Tt=new Mesh(rt,Pt);return Tt.position.set(Ct-16/2,gt-16/2,vt-28/2),d.add(Tt),Tt}),_e=new OrbitControls($,tt.domElement);_e.dampingFactor=.05,_e.enabled=!1,$.position.set(16/2,28*3,0),$.lookAt(new Vector3(16/2,0,16/2));let it=0;const nt=5,ct=()=>{if(requestAnimationFrame(ct),_e.update(),it%nt===0){for(let pt=0;pt<27;pt++)ot[pt]=ot[pt+1];ot[27]=ht(ot[27],16,16),d.rotation.z+=.02,ot.flat(2).forEach((pt,yt)=>{lt[yt].material=pt?et:st})}tt.render(d,$),it++},ht=(pt,yt,vt)=>pt.map((gt,Ct)=>gt.map((Pt,Tt)=>{const Rt=ft(pt,Tt,Ct,yt,vt);return Pt&&Rt===2||Rt===3})),ft=(pt,yt,vt,gt,Ct)=>{let Pt=0;for(let Tt=-1;Tt<=1;Tt++)for(let Rt=-1;Rt<=1;Rt++){if(Tt===0&&Rt===0)continue;const wt=(yt+Tt+gt)%gt,_t=(vt+Rt+Ct)%Ct;pt[_t][wt]&&Pt++}return Pt};return ct(),()=>{tt.dispose()}},[]),jsxRuntimeExports.jsx("div",{ref:s})};var DefaultContext={color:void 0,size:void 0,className:void 0,style:void 0,attr:void 0},IconContext=React.createContext&&React.createContext(DefaultContext),_excluded=["attr","size","title"];function _objectWithoutProperties(s,e){if(s==null)return{};var a=_objectWithoutPropertiesLoose(s,e),o,c;if(Object.getOwnPropertySymbols){var d=Object.getOwnPropertySymbols(s);for(c=0;c<d.length;c++)o=d[c],!(e.indexOf(o)>=0)&&Object.prototype.propertyIsEnumerable.call(s,o)&&(a[o]=s[o])}return a}function _objectWithoutPropertiesLoose(s,e){if(s==null)return{};var a={},o=Object.keys(s),c,d;for(d=0;d<o.length;d++)c=o[d],!(e.indexOf(c)>=0)&&(a[c]=s[c]);return a}function _extends$1(){return _extends$1=Object.assign?Object.assign.bind():function(s){for(var e=1;e<arguments.length;e++){var a=arguments[e];for(var o in a)Object.prototype.hasOwnProperty.call(a,o)&&(s[o]=a[o])}return s},_extends$1.apply(this,arguments)}function ownKeys(s,e){var a=Object.keys(s);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(s);e&&(o=o.filter(function(c){return Object.getOwnPropertyDescriptor(s,c).enumerable})),a.push.apply(a,o)}return a}function _objectSpread(s){for(var e=1;e<arguments.length;e++){var a=arguments[e]!=null?arguments[e]:{};e%2?ownKeys(Object(a),!0).forEach(function(o){_defineProperty$1(s,o,a[o])}):Object.getOwnPropertyDescriptors?Object.defineProperties(s,Object.getOwnPropertyDescriptors(a)):ownKeys(Object(a)).forEach(function(o){Object.defineProperty(s,o,Object.getOwnPropertyDescriptor(a,o))})}return s}function _defineProperty$1(s,e,a){return e=_toPropertyKey(e),e in s?Object.defineProperty(s,e,{value:a,enumerable:!0,configurable:!0,writable:!0}):s[e]=a,s}function _toPropertyKey(s){var e=_toPrimitive$1(s,"string");return typeof e=="symbol"?e:String(e)}function _toPrimitive$1(s,e){if(typeof s!="object"||s===null)return s;var a=s[Symbol.toPrimitive];if(a!==void 0){var o=a.call(s,e||"default");if(typeof o!="object")return o;throw new TypeError("@@toPrimitive must return a primitive value.")}return(e==="string"?String:Number)(s)}function Tree2Element(s){return s&&s.map((e,a)=>React.createElement(e.tag,_objectSpread({key:a},e.attr),Tree2Element(e.child)))}function GenIcon(s){return e=>React.createElement(IconBase,_extends$1({attr:_objectSpread({},s.attr)},e),Tree2Element(s.child))}function IconBase(s){var e=a=>{var{attr:o,size:c,title:d}=s,g=_objectWithoutProperties(s,_excluded),_=c||a.size||"1em",b;return a.className&&(b=a.className),s.className&&(b=(b?b+" ":"")+s.className),React.createElement("svg",_extends$1({stroke:"currentColor",fill:"currentColor",strokeWidth:"0"},a.attr,o,g,{className:b,style:_objectSpread(_objectSpread({color:s.color||a.color},a.style),s.style),height:_,width:_,xmlns:"http://www.w3.org/2000/svg"}),d&&React.createElement("title",null,d),s.children)};return IconContext!==void 0?React.createElement(IconContext.Consumer,null,a=>e(a)):e(DefaultContext)}const NavBar=()=>jsxRuntimeExports.jsx("div",{className:"fixed top-0 left-0 right-0 mx-auto w-1/4 max-w-screen-lg bg-black bg-opacity-0 backdrop-blur text-white z-50 rounded-b-lg",children:jsxRuntimeExports.jsxs("div",{className:"flex justify-center items-center py-4",children:[jsxRuntimeExports.jsxs("a",{className:"px-4 py-2 group text-white hover:text-gray-300",href:"#home",children:["HOME",jsxRuntimeExports.jsx("div",{className:"bg-gray-500 h-[2px] w-0 group-hover:w-full transition-all duration-500"})]}),jsxRuntimeExports.jsxs("a",{className:"px-4 py-2 group text-white hover:text-gray-300",href:"#skills",children:["SKILLS",jsxRuntimeExports.jsx("div",{className:"bg-gray-500 h-[2px] w-0 group-hover:w-full transition-all duration-500"})]}),jsxRuntimeExports.jsxs("a",{className:"px-4 py-2 group text-white hover:text-gray-300",href:"#projects",children:["PROJECTS",jsxRuntimeExports.jsx("div",{className:"bg-gray-500 h-[2px] w-0 group-hover:w-full transition-all duration-500"})]}),jsxRuntimeExports.jsxs("a",{className:"px-4 py-2 group text-white hover:text-gray-300",href:"#contact",children:["CONTACT",jsxRuntimeExports.jsx("div",{className:"bg-gray-500 h-[2px] w-0 group-hover:w-full transition-all duration-500"})]})]})}),Hero=()=>jsxRuntimeExports.jsxs("div",{className:"relative flex flex-1 overflow-hidden h-screen",children:[jsxRuntimeExports.jsxs("div",{className:"w-1/3 flex flex-col justify-start text-white pl-48 pt-48 break-keep",children:[jsxRuntimeExports.jsxs("h1",{className:"text-8xl font-bold mb-4 whitespace-nowrap",children:["NICHOLAS ",jsxRuntimeExports.jsx("br",{})," MAYER-RUPERT"]}),jsxRuntimeExports.jsx("p",{className:"text-3xl ml-16",children:"COMPUTER SCIENCE STUDENT AT SFU. SOFTWARE ENGINEERING ENJOYER."})]}),jsxRuntimeExports.jsx("div",{className:"w-1/2 relative",children:jsxRuntimeExports.jsx(GameOfLife3D,{className:"absolute top-0 left-0 w-full h-full object-cover"})}),jsxRuntimeExports.jsx("div",{className:"absolute bottom-0 left-0 w-full h-1/6 bg-gradient-to-t from-[#121212] to-transparent"}),jsxRuntimeExports.jsx("div",{className:"absolute top-0 left-0 w-full h-1/6 bg-gradient-to-t from-transparent to-[#121212]"})]});var dist={},_extends={},_global={exports:{}},global$5=_global.exports=typeof window<"u"&&window.Math==Math?window:typeof self<"u"&&self.Math==Math?self:Function("return this")();typeof __g=="number"&&(__g=global$5);var _globalExports=_global.exports,_core={exports:{}},core$4=_core.exports={version:"2.6.12"};typeof __e=="number"&&(__e=core$4);var _coreExports=_core.exports,_aFunction=function(s){if(typeof s!="function")throw TypeError(s+" is not a function!");return s},aFunction=_aFunction,_ctx=function(s,e,a){if(aFunction(s),e===void 0)return s;switch(a){case 1:return function(o){return s.call(e,o)};case 2:return function(o,c){return s.call(e,o,c)};case 3:return function(o,c,d){return s.call(e,o,c,d)}}return function(){return s.apply(e,arguments)}},_objectDp={},_isObject=function(s){return typeof s=="object"?s!==null:typeof s=="function"},isObject$3=_isObject,_anObject=function(s){if(!isObject$3(s))throw TypeError(s+" is not an object!");return s},_fails=function(s){try{return!!s()}catch{return!0}},_descriptors=!_fails(function(){return Object.defineProperty({},"a",{get:function(){return 7}}).a!=7}),_domCreate,hasRequired_domCreate;function require_domCreate(){if(hasRequired_domCreate)return _domCreate;hasRequired_domCreate=1;var s=_isObject,e=_globalExports.document,a=s(e)&&s(e.createElement);return _domCreate=function(o){return a?e.createElement(o):{}},_domCreate}var _ie8DomDefine=!_descriptors&&!_fails(function(){return Object.defineProperty(require_domCreate()("div"),"a",{get:function(){return 7}}).a!=7}),isObject$2=_isObject,_toPrimitive=function(s,e){if(!isObject$2(s))return s;var a,o;if(e&&typeof(a=s.toString)=="function"&&!isObject$2(o=a.call(s))||typeof(a=s.valueOf)=="function"&&!isObject$2(o=a.call(s))||!e&&typeof(a=s.toString)=="function"&&!isObject$2(o=a.call(s)))return o;throw TypeError("Can't convert object to primitive value")},anObject$3=_anObject,IE8_DOM_DEFINE$1=_ie8DomDefine,toPrimitive$2=_toPrimitive,dP$3=Object.defineProperty;_objectDp.f=_descriptors?Object.defineProperty:function(e,a,o){if(anObject$3(e),a=toPrimitive$2(a,!0),anObject$3(o),IE8_DOM_DEFINE$1)try{return dP$3(e,a,o)}catch{}if("get"in o||"set"in o)throw TypeError("Accessors not supported!");return"value"in o&&(e[a]=o.value),e};var _propertyDesc=function(s,e){return{enumerable:!(s&1),configurable:!(s&2),writable:!(s&4),value:e}},dP$2=_objectDp,createDesc$2=_propertyDesc,_hide=_descriptors?function(s,e,a){return dP$2.f(s,e,createDesc$2(1,a))}:function(s,e,a){return s[e]=a,s},hasOwnProperty={}.hasOwnProperty,_has=function(s,e){return hasOwnProperty.call(s,e)},global$4=_globalExports,core$3=_coreExports,ctx=_ctx,hide$2=_hide,has$6=_has,PROTOTYPE$2="prototype",$export$7=function(s,e,a){var o=s&$export$7.F,c=s&$export$7.G,d=s&$export$7.S,g=s&$export$7.P,_=s&$export$7.B,b=s&$export$7.W,$=c?core$3:core$3[e]||(core$3[e]={}),tt=$[PROTOTYPE$2],rt=c?global$4:d?global$4[e]:(global$4[e]||{})[PROTOTYPE$2],et,st,ot;c&&(a=e);for(et in a)st=!o&&rt&&rt[et]!==void 0,!(st&&has$6($,et))&&(ot=st?rt[et]:a[et],$[et]=c&&typeof rt[et]!="function"?a[et]:_&&st?ctx(ot,global$4):b&&rt[et]==ot?function(at){var lt=function(_e,it,nt){if(this instanceof at){switch(arguments.length){case 0:return new at;case 1:return new at(_e);case 2:return new at(_e,it)}return new at(_e,it,nt)}return at.apply(this,arguments)};return lt[PROTOTYPE$2]=at[PROTOTYPE$2],lt}(ot):g&&typeof ot=="function"?ctx(Function.call,ot):ot,g&&(($.virtual||($.virtual={}))[et]=ot,s&$export$7.R&&tt&&!tt[et]&&hide$2(tt,et,ot)))};$export$7.F=1;$export$7.G=2;$export$7.S=4;$export$7.P=8;$export$7.B=16;$export$7.W=32;$export$7.U=64;$export$7.R=128;var _export=$export$7,toString$1={}.toString,_cof=function(s){return toString$1.call(s).slice(8,-1)},cof$1=_cof,_iobject=Object("z").propertyIsEnumerable(0)?Object:function(s){return cof$1(s)=="String"?s.split(""):Object(s)},_defined=function(s){if(s==null)throw TypeError("Can't call method on  "+s);return s},IObject=_iobject,defined$2=_defined,_toIobject=function(s){return IObject(defined$2(s))},ceil=Math.ceil,floor=Math.floor,_toInteger=function(s){return isNaN(s=+s)?0:(s>0?floor:ceil)(s)},toInteger$2=_toInteger,min$1=Math.min,_toLength=function(s){return s>0?min$1(toInteger$2(s),9007199254740991):0},toInteger$1=_toInteger,max=Math.max,min=Math.min,_toAbsoluteIndex=function(s,e){return s=toInteger$1(s),s<0?max(s+e,0):min(s,e)},toIObject$5=_toIobject,toLength=_toLength,toAbsoluteIndex=_toAbsoluteIndex,_arrayIncludes=function(s){return function(e,a,o){var c=toIObject$5(e),d=toLength(c.length),g=toAbsoluteIndex(o,d),_;if(s&&a!=a){for(;d>g;)if(_=c[g++],_!=_)return!0}else for(;d>g;g++)if((s||g in c)&&c[g]===a)return s||g||0;return!s&&-1}},_shared={exports:{}},_library=!0,core$2=_coreExports,global$3=_globalExports,SHARED="__core-js_shared__",store$1=global$3[SHARED]||(global$3[SHARED]={});(_shared.exports=function(s,e){return store$1[s]||(store$1[s]=e!==void 0?e:{})})("versions",[]).push({version:core$2.version,mode:"pure",copyright:"© 2020 Denis Pushkarev (zloirock.ru)"});var _sharedExports=_shared.exports,id$1=0,px=Math.random(),_uid=function(s){return"Symbol(".concat(s===void 0?"":s,")_",(++id$1+px).toString(36))},shared$1=_sharedExports("keys"),uid$2=_uid,_sharedKey=function(s){return shared$1[s]||(shared$1[s]=uid$2(s))},has$5=_has,toIObject$4=_toIobject,arrayIndexOf=_arrayIncludes(!1),IE_PROTO$2=_sharedKey("IE_PROTO"),_objectKeysInternal=function(s,e){var a=toIObject$4(s),o=0,c=[],d;for(d in a)d!=IE_PROTO$2&&has$5(a,d)&&c.push(d);for(;e.length>o;)has$5(a,d=e[o++])&&(~arrayIndexOf(c,d)||c.push(d));return c},_enumBugKeys="constructor,hasOwnProperty,isPrototypeOf,propertyIsEnumerable,toLocaleString,toString,valueOf".split(","),$keys$2=_objectKeysInternal,enumBugKeys$1=_enumBugKeys,_objectKeys=Object.keys||function(e){return $keys$2(e,enumBugKeys$1)},_objectGops={};_objectGops.f=Object.getOwnPropertySymbols;var _objectPie={};_objectPie.f={}.propertyIsEnumerable;var defined$1=_defined,_toObject=function(s){return Object(defined$1(s))},_objectAssign,hasRequired_objectAssign;function require_objectAssign(){if(hasRequired_objectAssign)return _objectAssign;hasRequired_objectAssign=1;var s=_descriptors,e=_objectKeys,a=_objectGops,o=_objectPie,c=_toObject,d=_iobject,g=Object.assign;return _objectAssign=!g||_fails(function(){var _={},b={},$=Symbol(),tt="abcdefghijklmnopqrst";return _[$]=7,tt.split("").forEach(function(rt){b[rt]=rt}),g({},_)[$]!=7||Object.keys(g({},b)).join("")!=tt})?function(b,$){for(var tt=c(b),rt=arguments.length,et=1,st=a.f,ot=o.f;rt>et;)for(var at=d(arguments[et++]),lt=st?e(at).concat(st(at)):e(at),_e=lt.length,it=0,nt;_e>it;)nt=lt[it++],(!s||ot.call(at,nt))&&(tt[nt]=at[nt]);return tt}:g,_objectAssign}var $export$6=_export;$export$6($export$6.S+$export$6.F,"Object",{assign:require_objectAssign()});var assign$1=_coreExports.Object.assign,assign={default:assign$1,__esModule:!0};_extends.__esModule=!0;var _assign=assign,_assign2=_interopRequireDefault$5(_assign);function _interopRequireDefault$5(s){return s&&s.__esModule?s:{default:s}}_extends.default=_assign2.default||function(s){for(var e=1;e<arguments.length;e++){var a=arguments[e];for(var o in a)Object.prototype.hasOwnProperty.call(a,o)&&(s[o]=a[o])}return s};var has$4=_has,toObject$2=_toObject,IE_PROTO$1=_sharedKey("IE_PROTO"),ObjectProto$1=Object.prototype,_objectGpo=Object.getPrototypeOf||function(s){return s=toObject$2(s),has$4(s,IE_PROTO$1)?s[IE_PROTO$1]:typeof s.constructor=="function"&&s instanceof s.constructor?s.constructor.prototype:s instanceof Object?ObjectProto$1:null},$export$5=_export,core$1=_coreExports,fails=_fails,_objectSap=function(s,e){var a=(core$1.Object||{})[s]||Object[s],o={};o[s]=e(a),$export$5($export$5.S+$export$5.F*fails(function(){a(1)}),"Object",o)},toObject$1=_toObject,$getPrototypeOf=_objectGpo;_objectSap("getPrototypeOf",function(){return function(e){return $getPrototypeOf(toObject$1(e))}});var getPrototypeOf$2=_coreExports.Object.getPrototypeOf,getPrototypeOf$1={default:getPrototypeOf$2,__esModule:!0},classCallCheck={};classCallCheck.__esModule=!0;classCallCheck.default=function(s,e){if(!(s instanceof e))throw new TypeError("Cannot call a class as a function")};var createClass={},$export$4=_export;$export$4($export$4.S+$export$4.F*!_descriptors,"Object",{defineProperty:_objectDp.f});var $Object$1=_coreExports.Object,defineProperty$2=function(e,a,o){return $Object$1.defineProperty(e,a,o)},defineProperty$1={default:defineProperty$2,__esModule:!0};createClass.__esModule=!0;var _defineProperty=defineProperty$1,_defineProperty2=_interopRequireDefault$4(_defineProperty);function _interopRequireDefault$4(s){return s&&s.__esModule?s:{default:s}}createClass.default=function(){function s(e,a){for(var o=0;o<a.length;o++){var c=a[o];c.enumerable=c.enumerable||!1,c.configurable=!0,"value"in c&&(c.writable=!0),(0,_defineProperty2.default)(e,c.key,c)}}return function(e,a,o){return a&&s(e.prototype,a),o&&s(e,o),e}}();var possibleConstructorReturn={},_typeof$1={},toInteger=_toInteger,defined=_defined,_stringAt=function(s){return function(e,a){var o=String(defined(e)),c=toInteger(a),d=o.length,g,_;return c<0||c>=d?s?"":void 0:(g=o.charCodeAt(c),g<55296||g>56319||c+1===d||(_=o.charCodeAt(c+1))<56320||_>57343?s?o.charAt(c):g:s?o.slice(c,c+2):(g-55296<<10)+(_-56320)+65536)}},_redefine=_hide,_iterators={},dP$1=_objectDp,anObject$2=_anObject,getKeys$1=_objectKeys,_objectDps=_descriptors?Object.defineProperties:function(e,a){anObject$2(e);for(var o=getKeys$1(a),c=o.length,d=0,g;c>d;)dP$1.f(e,g=o[d++],a[g]);return e},_html,hasRequired_html;function require_html(){if(hasRequired_html)return _html;hasRequired_html=1;var s=_globalExports.document;return _html=s&&s.documentElement,_html}var anObject$1=_anObject,dPs=_objectDps,enumBugKeys=_enumBugKeys,IE_PROTO=_sharedKey("IE_PROTO"),Empty=function(){},PROTOTYPE$1="prototype",createDict=function(){var s=require_domCreate()("iframe"),e=enumBugKeys.length,a="<",o=">",c;for(s.style.display="none",require_html().appendChild(s),s.src="javascript:",c=s.contentWindow.document,c.open(),c.write(a+"script"+o+"document.F=Object"+a+"/script"+o),c.close(),createDict=c.F;e--;)delete createDict[PROTOTYPE$1][enumBugKeys[e]];return createDict()},_objectCreate=Object.create||function(e,a){var o;return e!==null?(Empty[PROTOTYPE$1]=anObject$1(e),o=new Empty,Empty[PROTOTYPE$1]=null,o[IE_PROTO]=e):o=createDict(),a===void 0?o:dPs(o,a)},_wks={exports:{}},store=_sharedExports("wks"),uid$1=_uid,Symbol$1=_globalExports.Symbol,USE_SYMBOL=typeof Symbol$1=="function",$exports=_wks.exports=function(s){return store[s]||(store[s]=USE_SYMBOL&&Symbol$1[s]||(USE_SYMBOL?Symbol$1:uid$1)("Symbol."+s))};$exports.store=store;var _wksExports=_wks.exports,def=_objectDp.f,has$3=_has,TAG=_wksExports("toStringTag"),_setToStringTag=function(s,e,a){s&&!has$3(s=a?s:s.prototype,TAG)&&def(s,TAG,{configurable:!0,value:e})},create$2=_objectCreate,descriptor=_propertyDesc,setToStringTag$2=_setToStringTag,IteratorPrototype={};_hide(IteratorPrototype,_wksExports("iterator"),function(){return this});var _iterCreate=function(s,e,a){s.prototype=create$2(IteratorPrototype,{next:descriptor(1,a)}),setToStringTag$2(s,e+" Iterator")},$export$3=_export,redefine$1=_redefine,hide$1=_hide,Iterators$2=_iterators,$iterCreate=_iterCreate,setToStringTag$1=_setToStringTag,getPrototypeOf=_objectGpo,ITERATOR=_wksExports("iterator"),BUGGY=!([].keys&&"next"in[].keys()),FF_ITERATOR="@@iterator",KEYS="keys",VALUES="values",returnThis=function(){return this},_iterDefine=function(s,e,a,o,c,d,g){$iterCreate(a,e,o);var _=function(nt){if(!BUGGY&&nt in rt)return rt[nt];switch(nt){case KEYS:return function(){return new a(this,nt)};case VALUES:return function(){return new a(this,nt)}}return function(){return new a(this,nt)}},b=e+" Iterator",$=c==VALUES,tt=!1,rt=s.prototype,et=rt[ITERATOR]||rt[FF_ITERATOR]||c&&rt[c],st=et||_(c),ot=c?$?_("entries"):st:void 0,at=e=="Array"&&rt.entries||et,lt,_e,it;if(at&&(it=getPrototypeOf(at.call(new s)),it!==Object.prototype&&it.next&&setToStringTag$1(it,b,!0)),$&&et&&et.name!==VALUES&&(tt=!0,st=function(){return et.call(this)}),g&&(BUGGY||tt||!rt[ITERATOR])&&hide$1(rt,ITERATOR,st),Iterators$2[e]=st,Iterators$2[b]=returnThis,c)if(lt={values:$?st:_(VALUES),keys:d?st:_(KEYS),entries:ot},g)for(_e in lt)_e in rt||redefine$1(rt,_e,lt[_e]);else $export$3($export$3.P+$export$3.F*(BUGGY||tt),e,lt);return lt},$at=_stringAt(!0);_iterDefine(String,"String",function(s){this._t=String(s),this._i=0},function(){var s=this._t,e=this._i,a;return e>=s.length?{value:void 0,done:!0}:(a=$at(s,e),this._i+=a.length,{value:a,done:!1})});var _iterStep=function(s,e){return{value:e,done:!!s}},step=_iterStep,Iterators$1=_iterators,toIObject$3=_toIobject;_iterDefine(Array,"Array",function(s,e){this._t=toIObject$3(s),this._i=0,this._k=e},function(){var s=this._t,e=this._k,a=this._i++;return!s||a>=s.length?(this._t=void 0,step(1)):e=="keys"?step(0,a):e=="values"?step(0,s[a]):step(0,[a,s[a]])},"values");Iterators$1.Arguments=Iterators$1.Array;var global$2=_globalExports,hide=_hide,Iterators=_iterators,TO_STRING_TAG=_wksExports("toStringTag"),DOMIterables="CSSRuleList,CSSStyleDeclaration,CSSValueList,ClientRectList,DOMRectList,DOMStringList,DOMTokenList,DataTransferItemList,FileList,HTMLAllCollection,HTMLCollection,HTMLFormElement,HTMLSelectElement,MediaList,MimeTypeArray,NamedNodeMap,NodeList,PaintRequestList,Plugin,PluginArray,SVGLengthList,SVGNumberList,SVGPathSegList,SVGPointList,SVGStringList,SVGTransformList,SourceBufferList,StyleSheetList,TextTrackCueList,TextTrackList,TouchList".split(",");for(var i=0;i<DOMIterables.length;i++){var NAME=DOMIterables[i],Collection=global$2[NAME],proto=Collection&&Collection.prototype;proto&&!proto[TO_STRING_TAG]&&hide(proto,TO_STRING_TAG,NAME),Iterators[NAME]=Iterators.Array}var _wksExt={};_wksExt.f=_wksExports;var iterator$1=_wksExt.f("iterator"),iterator={default:iterator$1,__esModule:!0},_meta={exports:{}},META$1=_uid("meta"),isObject$1=_isObject,has$2=_has,setDesc=_objectDp.f,id=0,isExtensible=Object.isExtensible||function(){return!0},FREEZE=!_fails(function(){return isExtensible(Object.preventExtensions({}))}),setMeta=function(s){setDesc(s,META$1,{value:{i:"O"+ ++id,w:{}}})},fastKey=function(s,e){if(!isObject$1(s))return typeof s=="symbol"?s:(typeof s=="string"?"S":"P")+s;if(!has$2(s,META$1)){if(!isExtensible(s))return"F";if(!e)return"E";setMeta(s)}return s[META$1].i},getWeak=function(s,e){if(!has$2(s,META$1)){if(!isExtensible(s))return!0;if(!e)return!1;setMeta(s)}return s[META$1].w},onFreeze=function(s){return FREEZE&&meta$1.NEED&&isExtensible(s)&&!has$2(s,META$1)&&setMeta(s),s},meta$1=_meta.exports={KEY:META$1,NEED:!1,fastKey,getWeak,onFreeze},_metaExports=_meta.exports,core=_coreExports,wksExt$1=_wksExt,defineProperty=_objectDp.f,_wksDefine=function(s){var e=core.Symbol||(core.Symbol={});s.charAt(0)!="_"&&!(s in e)&&defineProperty(e,s,{value:wksExt$1.f(s)})},getKeys=_objectKeys,gOPS=_objectGops,pIE$1=_objectPie,_enumKeys=function(s){var e=getKeys(s),a=gOPS.f;if(a)for(var o=a(s),c=pIE$1.f,d=0,g;o.length>d;)c.call(s,g=o[d++])&&e.push(g);return e},cof=_cof,_isArray=Array.isArray||function(e){return cof(e)=="Array"},_objectGopnExt={},_objectGopn={},$keys$1=_objectKeysInternal,hiddenKeys=_enumBugKeys.concat("length","prototype");_objectGopn.f=Object.getOwnPropertyNames||function(e){return $keys$1(e,hiddenKeys)};var toIObject$2=_toIobject,gOPN$1=_objectGopn.f,toString={}.toString,windowNames=typeof window=="object"&&window&&Object.getOwnPropertyNames?Object.getOwnPropertyNames(window):[],getWindowNames=function(s){try{return gOPN$1(s)}catch{return windowNames.slice()}};_objectGopnExt.f=function(e){return windowNames&&toString.call(e)=="[object Window]"?getWindowNames(e):gOPN$1(toIObject$2(e))};var _objectGopd={},pIE=_objectPie,createDesc$1=_propertyDesc,toIObject$1=_toIobject,toPrimitive$1=_toPrimitive,has$1=_has,IE8_DOM_DEFINE=_ie8DomDefine,gOPD$1=Object.getOwnPropertyDescriptor;_objectGopd.f=_descriptors?gOPD$1:function(e,a){if(e=toIObject$1(e),a=toPrimitive$1(a,!0),IE8_DOM_DEFINE)try{return gOPD$1(e,a)}catch{}if(has$1(e,a))return createDesc$1(!pIE.f.call(e,a),e[a])};var global$1=_globalExports,has=_has,DESCRIPTORS=_descriptors,$export$2=_export,redefine=_redefine,META=_metaExports.KEY,$fails=_fails,shared=_sharedExports,setToStringTag=_setToStringTag,uid=_uid,wks=_wksExports,wksExt=_wksExt,wksDefine=_wksDefine,enumKeys=_enumKeys,isArray=_isArray,anObject=_anObject,isObject=_isObject,toObject=_toObject,toIObject=_toIobject,toPrimitive=_toPrimitive,createDesc=_propertyDesc,_create$1=_objectCreate,gOPNExt=_objectGopnExt,$GOPD=_objectGopd,$GOPS=_objectGops,$DP=_objectDp,$keys=_objectKeys,gOPD=$GOPD.f,dP=$DP.f,gOPN=gOPNExt.f,$Symbol=global$1.Symbol,$JSON=global$1.JSON,_stringify=$JSON&&$JSON.stringify,PROTOTYPE="prototype",HIDDEN=wks("_hidden"),TO_PRIMITIVE=wks("toPrimitive"),isEnum={}.propertyIsEnumerable,SymbolRegistry=shared("symbol-registry"),AllSymbols=shared("symbols"),OPSymbols=shared("op-symbols"),ObjectProto=Object[PROTOTYPE],USE_NATIVE=typeof $Symbol=="function"&&!!$GOPS.f,QObject=global$1.QObject,setter=!QObject||!QObject[PROTOTYPE]||!QObject[PROTOTYPE].findChild,setSymbolDesc=DESCRIPTORS&&$fails(function(){return _create$1(dP({},"a",{get:function(){return dP(this,"a",{value:7}).a}})).a!=7})?function(s,e,a){var o=gOPD(ObjectProto,e);o&&delete ObjectProto[e],dP(s,e,a),o&&s!==ObjectProto&&dP(ObjectProto,e,o)}:dP,wrap=function(s){var e=AllSymbols[s]=_create$1($Symbol[PROTOTYPE]);return e._k=s,e},isSymbol=USE_NATIVE&&typeof $Symbol.iterator=="symbol"?function(s){return typeof s=="symbol"}:function(s){return s instanceof $Symbol},$defineProperty=function(e,a,o){return e===ObjectProto&&$defineProperty(OPSymbols,a,o),anObject(e),a=toPrimitive(a,!0),anObject(o),has(AllSymbols,a)?(o.enumerable?(has(e,HIDDEN)&&e[HIDDEN][a]&&(e[HIDDEN][a]=!1),o=_create$1(o,{enumerable:createDesc(0,!1)})):(has(e,HIDDEN)||dP(e,HIDDEN,createDesc(1,{})),e[HIDDEN][a]=!0),setSymbolDesc(e,a,o)):dP(e,a,o)},$defineProperties=function(e,a){anObject(e);for(var o=enumKeys(a=toIObject(a)),c=0,d=o.length,g;d>c;)$defineProperty(e,g=o[c++],a[g]);return e},$create=function(e,a){return a===void 0?_create$1(e):$defineProperties(_create$1(e),a)},$propertyIsEnumerable=function(e){var a=isEnum.call(this,e=toPrimitive(e,!0));return this===ObjectProto&&has(AllSymbols,e)&&!has(OPSymbols,e)?!1:a||!has(this,e)||!has(AllSymbols,e)||has(this,HIDDEN)&&this[HIDDEN][e]?a:!0},$getOwnPropertyDescriptor=function(e,a){if(e=toIObject(e),a=toPrimitive(a,!0),!(e===ObjectProto&&has(AllSymbols,a)&&!has(OPSymbols,a))){var o=gOPD(e,a);return o&&has(AllSymbols,a)&&!(has(e,HIDDEN)&&e[HIDDEN][a])&&(o.enumerable=!0),o}},$getOwnPropertyNames=function(e){for(var a=gOPN(toIObject(e)),o=[],c=0,d;a.length>c;)!has(AllSymbols,d=a[c++])&&d!=HIDDEN&&d!=META&&o.push(d);return o},$getOwnPropertySymbols=function(e){for(var a=e===ObjectProto,o=gOPN(a?OPSymbols:toIObject(e)),c=[],d=0,g;o.length>d;)has(AllSymbols,g=o[d++])&&(!a||has(ObjectProto,g))&&c.push(AllSymbols[g]);return c};USE_NATIVE||($Symbol=function(){if(this instanceof $Symbol)throw TypeError("Symbol is not a constructor!");var e=uid(arguments.length>0?arguments[0]:void 0),a=function(o){this===ObjectProto&&a.call(OPSymbols,o),has(this,HIDDEN)&&has(this[HIDDEN],e)&&(this[HIDDEN][e]=!1),setSymbolDesc(this,e,createDesc(1,o))};return DESCRIPTORS&&setter&&setSymbolDesc(ObjectProto,e,{configurable:!0,set:a}),wrap(e)},redefine($Symbol[PROTOTYPE],"toString",function(){return this._k}),$GOPD.f=$getOwnPropertyDescriptor,$DP.f=$defineProperty,_objectGopn.f=gOPNExt.f=$getOwnPropertyNames,_objectPie.f=$propertyIsEnumerable,$GOPS.f=$getOwnPropertySymbols,DESCRIPTORS&&!_library&&redefine(ObjectProto,"propertyIsEnumerable",$propertyIsEnumerable),wksExt.f=function(s){return wrap(wks(s))});$export$2($export$2.G+$export$2.W+$export$2.F*!USE_NATIVE,{Symbol:$Symbol});for(var es6Symbols="hasInstance,isConcatSpreadable,iterator,match,replace,search,species,split,toPrimitive,toStringTag,unscopables".split(","),j=0;es6Symbols.length>j;)wks(es6Symbols[j++]);for(var wellKnownSymbols=$keys(wks.store),k=0;wellKnownSymbols.length>k;)wksDefine(wellKnownSymbols[k++]);$export$2($export$2.S+$export$2.F*!USE_NATIVE,"Symbol",{for:function(s){return has(SymbolRegistry,s+="")?SymbolRegistry[s]:SymbolRegistry[s]=$Symbol(s)},keyFor:function(e){if(!isSymbol(e))throw TypeError(e+" is not a symbol!");for(var a in SymbolRegistry)if(SymbolRegistry[a]===e)return a},useSetter:function(){setter=!0},useSimple:function(){setter=!1}});$export$2($export$2.S+$export$2.F*!USE_NATIVE,"Object",{create:$create,defineProperty:$defineProperty,defineProperties:$defineProperties,getOwnPropertyDescriptor:$getOwnPropertyDescriptor,getOwnPropertyNames:$getOwnPropertyNames,getOwnPropertySymbols:$getOwnPropertySymbols});var FAILS_ON_PRIMITIVES=$fails(function(){$GOPS.f(1)});$export$2($export$2.S+$export$2.F*FAILS_ON_PRIMITIVES,"Object",{getOwnPropertySymbols:function(e){return $GOPS.f(toObject(e))}});$JSON&&$export$2($export$2.S+$export$2.F*(!USE_NATIVE||$fails(function(){var s=$Symbol();return _stringify([s])!="[null]"||_stringify({a:s})!="{}"||_stringify(Object(s))!="{}"})),"JSON",{stringify:function(e){for(var a=[e],o=1,c,d;arguments.length>o;)a.push(arguments[o++]);if(d=c=a[1],!(!isObject(c)&&e===void 0||isSymbol(e)))return isArray(c)||(c=function(g,_){if(typeof d=="function"&&(_=d.call(this,g,_)),!isSymbol(_))return _}),a[1]=c,_stringify.apply($JSON,a)}});$Symbol[PROTOTYPE][TO_PRIMITIVE]||_hide($Symbol[PROTOTYPE],TO_PRIMITIVE,$Symbol[PROTOTYPE].valueOf);setToStringTag($Symbol,"Symbol");setToStringTag(Math,"Math",!0);setToStringTag(global$1.JSON,"JSON",!0);_wksDefine("asyncIterator");_wksDefine("observable");var symbol$1=_coreExports.Symbol,symbol={default:symbol$1,__esModule:!0};_typeof$1.__esModule=!0;var _iterator=iterator,_iterator2=_interopRequireDefault$3(_iterator),_symbol=symbol,_symbol2=_interopRequireDefault$3(_symbol),_typeof=typeof _symbol2.default=="function"&&typeof _iterator2.default=="symbol"?function(s){return typeof s}:function(s){return s&&typeof _symbol2.default=="function"&&s.constructor===_symbol2.default&&s!==_symbol2.default.prototype?"symbol":typeof s};function _interopRequireDefault$3(s){return s&&s.__esModule?s:{default:s}}_typeof$1.default=typeof _symbol2.default=="function"&&_typeof(_iterator2.default)==="symbol"?function(s){return typeof s>"u"?"undefined":_typeof(s)}:function(s){return s&&typeof _symbol2.default=="function"&&s.constructor===_symbol2.default&&s!==_symbol2.default.prototype?"symbol":typeof s>"u"?"undefined":_typeof(s)};possibleConstructorReturn.__esModule=!0;var _typeof2$1=_typeof$1,_typeof3$1=_interopRequireDefault$2(_typeof2$1);function _interopRequireDefault$2(s){return s&&s.__esModule?s:{default:s}}possibleConstructorReturn.default=function(s,e){if(!s)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&((typeof e>"u"?"undefined":(0,_typeof3$1.default)(e))==="object"||typeof e=="function")?e:s};var inherits={},_setProto,hasRequired_setProto;function require_setProto(){if(hasRequired_setProto)return _setProto;hasRequired_setProto=1;var s=_isObject,e=_anObject,a=function(o,c){if(e(o),!s(c)&&c!==null)throw TypeError(c+": can't set as prototype!")};return _setProto={set:Object.setPrototypeOf||("__proto__"in{}?function(o,c,d){try{d=_ctx(Function.call,_objectGopd.f(Object.prototype,"__proto__").set,2),d(o,[]),c=!(o instanceof Array)}catch{c=!0}return function(_,b){return a(_,b),c?_.__proto__=b:d(_,b),_}}({},!1):void 0),check:a},_setProto}var $export$1=_export;$export$1($export$1.S,"Object",{setPrototypeOf:require_setProto().set});var setPrototypeOf$1=_coreExports.Object.setPrototypeOf,setPrototypeOf={default:setPrototypeOf$1,__esModule:!0},$export=_export;$export($export.S,"Object",{create:_objectCreate});var $Object=_coreExports.Object,create$1=function(e,a){return $Object.create(e,a)},create={default:create$1,__esModule:!0};inherits.__esModule=!0;var _setPrototypeOf=setPrototypeOf,_setPrototypeOf2=_interopRequireDefault$1(_setPrototypeOf),_create=create,_create2=_interopRequireDefault$1(_create),_typeof2=_typeof$1,_typeof3=_interopRequireDefault$1(_typeof2);function _interopRequireDefault$1(s){return s&&s.__esModule?s:{default:s}}inherits.default=function(s,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+(typeof e>"u"?"undefined":(0,_typeof3.default)(e)));s.prototype=(0,_create2.default)(e&&e.prototype,{constructor:{value:s,enumerable:!1,writable:!0,configurable:!0}}),e&&(_setPrototypeOf2.default?(0,_setPrototypeOf2.default)(s,e):s.__proto__=e)};var propTypes={exports:{}},ReactPropTypesSecret$1="SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED",ReactPropTypesSecret_1=ReactPropTypesSecret$1,ReactPropTypesSecret=ReactPropTypesSecret_1;function emptyFunction(){}function emptyFunctionWithReset(){}emptyFunctionWithReset.resetWarningCache=emptyFunction;var factoryWithThrowingShims=function(){function s(o,c,d,g,_,b){if(b!==ReactPropTypesSecret){var $=new Error("Calling PropTypes validators directly is not supported by the `prop-types` package. Use PropTypes.checkPropTypes() to call them. Read more at http://fb.me/use-check-prop-types");throw $.name="Invariant Violation",$}}s.isRequired=s;function e(){return s}var a={array:s,bigint:s,bool:s,func:s,number:s,object:s,string:s,symbol:s,any:s,arrayOf:e,element:s,elementType:s,instanceOf:e,node:s,objectOf:e,oneOf:e,oneOfType:e,shape:e,exact:e,checkPropTypes:emptyFunctionWithReset,resetWarningCache:emptyFunction};return a.PropTypes=a,a};propTypes.exports=factoryWithThrowingShims();var propTypesExports=propTypes.exports,lottie={exports:{}};(function(module,exports){typeof navigator<"u"&&function(s,e){module.exports=e()}(commonjsGlobal,function(){var svgNS="http://www.w3.org/2000/svg",locationHref="",_useWebWorker=!1,initialDefaultFrame=-999999,setWebWorker=function(e){_useWebWorker=!!e},getWebWorker=function(){return _useWebWorker},setLocationHref=function(e){locationHref=e},getLocationHref=function(){return locationHref};function createTag(s){return document.createElement(s)}function extendPrototype(s,e){var a,o=s.length,c;for(a=0;a<o;a+=1){c=s[a].prototype;for(var d in c)Object.prototype.hasOwnProperty.call(c,d)&&(e.prototype[d]=c[d])}}function getDescriptor(s,e){return Object.getOwnPropertyDescriptor(s,e)}function createProxyFunction(s){function e(){}return e.prototype=s,e}var audioControllerFactory=function(){function s(e){this.audios=[],this.audioFactory=e,this._volume=1,this._isMuted=!1}return s.prototype={addAudio:function(a){this.audios.push(a)},pause:function(){var a,o=this.audios.length;for(a=0;a<o;a+=1)this.audios[a].pause()},resume:function(){var a,o=this.audios.length;for(a=0;a<o;a+=1)this.audios[a].resume()},setRate:function(a){var o,c=this.audios.length;for(o=0;o<c;o+=1)this.audios[o].setRate(a)},createAudio:function(a){return this.audioFactory?this.audioFactory(a):window.Howl?new window.Howl({src:[a]}):{isPlaying:!1,play:function(){this.isPlaying=!0},seek:function(){this.isPlaying=!1},playing:function(){},rate:function(){},setVolume:function(){}}},setAudioFactory:function(a){this.audioFactory=a},setVolume:function(a){this._volume=a,this._updateVolume()},mute:function(){this._isMuted=!0,this._updateVolume()},unmute:function(){this._isMuted=!1,this._updateVolume()},getVolume:function(){return this._volume},_updateVolume:function(){var a,o=this.audios.length;for(a=0;a<o;a+=1)this.audios[a].volume(this._volume*(this._isMuted?0:1))}},function(){return new s}}(),createTypedArray=function(){function s(a,o){var c=0,d=[],g;switch(a){case"int16":case"uint8c":g=1;break;default:g=1.1;break}for(c=0;c<o;c+=1)d.push(g);return d}function e(a,o){return a==="float32"?new Float32Array(o):a==="int16"?new Int16Array(o):a==="uint8c"?new Uint8ClampedArray(o):s(a,o)}return typeof Uint8ClampedArray=="function"&&typeof Float32Array=="function"?e:s}();function createSizedArray(s){return Array.apply(null,{length:s})}function _typeof$6(s){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?_typeof$6=function(a){return typeof a}:_typeof$6=function(a){return a&&typeof Symbol=="function"&&a.constructor===Symbol&&a!==Symbol.prototype?"symbol":typeof a},_typeof$6(s)}var subframeEnabled=!0,expressionsPlugin=null,expressionsInterfaces=null,idPrefix$1="",isSafari=/^((?!chrome|android).)*safari/i.test(navigator.userAgent),bmPow=Math.pow,bmSqrt=Math.sqrt,bmFloor=Math.floor,bmMax=Math.max,bmMin=Math.min,BMMath={};(function(){var s=["abs","acos","acosh","asin","asinh","atan","atanh","atan2","ceil","cbrt","expm1","clz32","cos","cosh","exp","floor","fround","hypot","imul","log","log1p","log2","log10","max","min","pow","random","round","sign","sin","sinh","sqrt","tan","tanh","trunc","E","LN10","LN2","LOG10E","LOG2E","PI","SQRT1_2","SQRT2"],e,a=s.length;for(e=0;e<a;e+=1)BMMath[s[e]]=Math[s[e]]})(),BMMath.random=Math.random,BMMath.abs=function(s){var e=_typeof$6(s);if(e==="object"&&s.length){var a=createSizedArray(s.length),o,c=s.length;for(o=0;o<c;o+=1)a[o]=Math.abs(s[o]);return a}return Math.abs(s)};var defaultCurveSegments=150,degToRads=Math.PI/180,roundCorner=.5519;function styleDiv(s){s.style.position="absolute",s.style.top=0,s.style.left=0,s.style.display="block",s.style.transformOrigin="0 0",s.style.webkitTransformOrigin="0 0",s.style.backfaceVisibility="visible",s.style.webkitBackfaceVisibility="visible",s.style.transformStyle="preserve-3d",s.style.webkitTransformStyle="preserve-3d",s.style.mozTransformStyle="preserve-3d"}function BMEnterFrameEvent(s,e,a,o){this.type=s,this.currentTime=e,this.totalTime=a,this.direction=o<0?-1:1}function BMCompleteEvent(s,e){this.type=s,this.direction=e<0?-1:1}function BMCompleteLoopEvent(s,e,a,o){this.type=s,this.currentLoop=a,this.totalLoops=e,this.direction=o<0?-1:1}function BMSegmentStartEvent(s,e,a){this.type=s,this.firstFrame=e,this.totalFrames=a}function BMDestroyEvent(s,e){this.type=s,this.target=e}function BMRenderFrameErrorEvent(s,e){this.type="renderFrameError",this.nativeError=s,this.currentTime=e}function BMConfigErrorEvent(s){this.type="configError",this.nativeError=s}var createElementID=function(){var s=0;return function(){return s+=1,idPrefix$1+"__lottie_element_"+s}}();function HSVtoRGB(s,e,a){var o,c,d,g,_,b,$,tt;switch(g=Math.floor(s*6),_=s*6-g,b=a*(1-e),$=a*(1-_*e),tt=a*(1-(1-_)*e),g%6){case 0:o=a,c=tt,d=b;break;case 1:o=$,c=a,d=b;break;case 2:o=b,c=a,d=tt;break;case 3:o=b,c=$,d=a;break;case 4:o=tt,c=b,d=a;break;case 5:o=a,c=b,d=$;break}return[o,c,d]}function RGBtoHSV(s,e,a){var o=Math.max(s,e,a),c=Math.min(s,e,a),d=o-c,g,_=o===0?0:d/o,b=o/255;switch(o){case c:g=0;break;case s:g=e-a+d*(e<a?6:0),g/=6*d;break;case e:g=a-s+d*2,g/=6*d;break;case a:g=s-e+d*4,g/=6*d;break}return[g,_,b]}function addSaturationToRGB(s,e){var a=RGBtoHSV(s[0]*255,s[1]*255,s[2]*255);return a[1]+=e,a[1]>1?a[1]=1:a[1]<=0&&(a[1]=0),HSVtoRGB(a[0],a[1],a[2])}function addBrightnessToRGB(s,e){var a=RGBtoHSV(s[0]*255,s[1]*255,s[2]*255);return a[2]+=e,a[2]>1?a[2]=1:a[2]<0&&(a[2]=0),HSVtoRGB(a[0],a[1],a[2])}function addHueToRGB(s,e){var a=RGBtoHSV(s[0]*255,s[1]*255,s[2]*255);return a[0]+=e/360,a[0]>1?a[0]-=1:a[0]<0&&(a[0]+=1),HSVtoRGB(a[0],a[1],a[2])}var rgbToHex=function(){var s=[],e,a;for(e=0;e<256;e+=1)a=e.toString(16),s[e]=a.length===1?"0"+a:a;return function(o,c,d){return o<0&&(o=0),c<0&&(c=0),d<0&&(d=0),"#"+s[o]+s[c]+s[d]}}(),setSubframeEnabled=function(e){subframeEnabled=!!e},getSubframeEnabled=function(){return subframeEnabled},setExpressionsPlugin=function(e){expressionsPlugin=e},getExpressionsPlugin=function(){return expressionsPlugin},setExpressionInterfaces=function(e){expressionsInterfaces=e},getExpressionInterfaces=function(){return expressionsInterfaces},setDefaultCurveSegments=function(e){defaultCurveSegments=e},getDefaultCurveSegments=function(){return defaultCurveSegments},setIdPrefix=function(e){idPrefix$1=e};function createNS(s){return document.createElementNS(svgNS,s)}function _typeof$5(s){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?_typeof$5=function(a){return typeof a}:_typeof$5=function(a){return a&&typeof Symbol=="function"&&a.constructor===Symbol&&a!==Symbol.prototype?"symbol":typeof a},_typeof$5(s)}var dataManager=function(){var s=1,e=[],a,o,c={onmessage:function(){},postMessage:function(st){a({data:st})}},d={postMessage:function(st){c.onmessage({data:st})}};function g(et){if(window.Worker&&window.Blob&&getWebWorker()){var st=new Blob(["var _workerSelf = self; self.onmessage = ",et.toString()],{type:"text/javascript"}),ot=URL.createObjectURL(st);return new Worker(ot)}return a=et,c}function _(){o||(o=g(function(st){function ot(){function lt(wt,_t){var St,ut,dt=wt.length,Mt,At,Bt,Xt;for(ut=0;ut<dt;ut+=1)if(St=wt[ut],"ks"in St&&!St.completed){if(St.completed=!0,St.hasMask){var It=St.masksProperties;for(At=It.length,Mt=0;Mt<At;Mt+=1)if(It[Mt].pt.k.i)ht(It[Mt].pt.k);else for(Xt=It[Mt].pt.k.length,Bt=0;Bt<Xt;Bt+=1)It[Mt].pt.k[Bt].s&&ht(It[Mt].pt.k[Bt].s[0]),It[Mt].pt.k[Bt].e&&ht(It[Mt].pt.k[Bt].e[0])}St.ty===0?(St.layers=nt(St.refId,_t),lt(St.layers,_t)):St.ty===4?ct(St.shapes):St.ty===5&&Tt(St)}}function _e(wt,_t){if(wt){var St=0,ut=wt.length;for(St=0;St<ut;St+=1)wt[St].t===1&&(wt[St].data.layers=nt(wt[St].data.refId,_t),lt(wt[St].data.layers,_t))}}function it(wt,_t){for(var St=0,ut=_t.length;St<ut;){if(_t[St].id===wt)return _t[St];St+=1}return null}function nt(wt,_t){var St=it(wt,_t);return St?St.layers.__used?JSON.parse(JSON.stringify(St.layers)):(St.layers.__used=!0,St.layers):null}function ct(wt){var _t,St=wt.length,ut,dt;for(_t=St-1;_t>=0;_t-=1)if(wt[_t].ty==="sh")if(wt[_t].ks.k.i)ht(wt[_t].ks.k);else for(dt=wt[_t].ks.k.length,ut=0;ut<dt;ut+=1)wt[_t].ks.k[ut].s&&ht(wt[_t].ks.k[ut].s[0]),wt[_t].ks.k[ut].e&&ht(wt[_t].ks.k[ut].e[0]);else wt[_t].ty==="gr"&&ct(wt[_t].it)}function ht(wt){var _t,St=wt.i.length;for(_t=0;_t<St;_t+=1)wt.i[_t][0]+=wt.v[_t][0],wt.i[_t][1]+=wt.v[_t][1],wt.o[_t][0]+=wt.v[_t][0],wt.o[_t][1]+=wt.v[_t][1]}function ft(wt,_t){var St=_t?_t.split("."):[100,100,100];return wt[0]>St[0]?!0:St[0]>wt[0]?!1:wt[1]>St[1]?!0:St[1]>wt[1]?!1:wt[2]>St[2]?!0:St[2]>wt[2]?!1:null}var pt=function(){var wt=[4,4,14];function _t(ut){var dt=ut.t.d;ut.t.d={k:[{s:dt,t:0}]}}function St(ut){var dt,Mt=ut.length;for(dt=0;dt<Mt;dt+=1)ut[dt].ty===5&&_t(ut[dt])}return function(ut){if(ft(wt,ut.v)&&(St(ut.layers),ut.assets)){var dt,Mt=ut.assets.length;for(dt=0;dt<Mt;dt+=1)ut.assets[dt].layers&&St(ut.assets[dt].layers)}}}(),yt=function(){var wt=[4,7,99];return function(_t){if(_t.chars&&!ft(wt,_t.v)){var St,ut=_t.chars.length;for(St=0;St<ut;St+=1){var dt=_t.chars[St];dt.data&&dt.data.shapes&&(ct(dt.data.shapes),dt.data.ip=0,dt.data.op=99999,dt.data.st=0,dt.data.sr=1,dt.data.ks={p:{k:[0,0],a:0},s:{k:[100,100],a:0},a:{k:[0,0],a:0},r:{k:0,a:0},o:{k:100,a:0}},_t.chars[St].t||(dt.data.shapes.push({ty:"no"}),dt.data.shapes[0].it.push({p:{k:[0,0],a:0},s:{k:[100,100],a:0},a:{k:[0,0],a:0},r:{k:0,a:0},o:{k:100,a:0},sk:{k:0,a:0},sa:{k:0,a:0},ty:"tr"})))}}}}(),vt=function(){var wt=[5,7,15];function _t(ut){var dt=ut.t.p;typeof dt.a=="number"&&(dt.a={a:0,k:dt.a}),typeof dt.p=="number"&&(dt.p={a:0,k:dt.p}),typeof dt.r=="number"&&(dt.r={a:0,k:dt.r})}function St(ut){var dt,Mt=ut.length;for(dt=0;dt<Mt;dt+=1)ut[dt].ty===5&&_t(ut[dt])}return function(ut){if(ft(wt,ut.v)&&(St(ut.layers),ut.assets)){var dt,Mt=ut.assets.length;for(dt=0;dt<Mt;dt+=1)ut.assets[dt].layers&&St(ut.assets[dt].layers)}}}(),gt=function(){var wt=[4,1,9];function _t(ut){var dt,Mt=ut.length,At,Bt;for(dt=0;dt<Mt;dt+=1)if(ut[dt].ty==="gr")_t(ut[dt].it);else if(ut[dt].ty==="fl"||ut[dt].ty==="st")if(ut[dt].c.k&&ut[dt].c.k[0].i)for(Bt=ut[dt].c.k.length,At=0;At<Bt;At+=1)ut[dt].c.k[At].s&&(ut[dt].c.k[At].s[0]/=255,ut[dt].c.k[At].s[1]/=255,ut[dt].c.k[At].s[2]/=255,ut[dt].c.k[At].s[3]/=255),ut[dt].c.k[At].e&&(ut[dt].c.k[At].e[0]/=255,ut[dt].c.k[At].e[1]/=255,ut[dt].c.k[At].e[2]/=255,ut[dt].c.k[At].e[3]/=255);else ut[dt].c.k[0]/=255,ut[dt].c.k[1]/=255,ut[dt].c.k[2]/=255,ut[dt].c.k[3]/=255}function St(ut){var dt,Mt=ut.length;for(dt=0;dt<Mt;dt+=1)ut[dt].ty===4&&_t(ut[dt].shapes)}return function(ut){if(ft(wt,ut.v)&&(St(ut.layers),ut.assets)){var dt,Mt=ut.assets.length;for(dt=0;dt<Mt;dt+=1)ut.assets[dt].layers&&St(ut.assets[dt].layers)}}}(),Ct=function(){var wt=[4,4,18];function _t(ut){var dt,Mt=ut.length,At,Bt;for(dt=Mt-1;dt>=0;dt-=1)if(ut[dt].ty==="sh")if(ut[dt].ks.k.i)ut[dt].ks.k.c=ut[dt].closed;else for(Bt=ut[dt].ks.k.length,At=0;At<Bt;At+=1)ut[dt].ks.k[At].s&&(ut[dt].ks.k[At].s[0].c=ut[dt].closed),ut[dt].ks.k[At].e&&(ut[dt].ks.k[At].e[0].c=ut[dt].closed);else ut[dt].ty==="gr"&&_t(ut[dt].it)}function St(ut){var dt,Mt,At=ut.length,Bt,Xt,It,Vt;for(Mt=0;Mt<At;Mt+=1){if(dt=ut[Mt],dt.hasMask){var Wt=dt.masksProperties;for(Xt=Wt.length,Bt=0;Bt<Xt;Bt+=1)if(Wt[Bt].pt.k.i)Wt[Bt].pt.k.c=Wt[Bt].cl;else for(Vt=Wt[Bt].pt.k.length,It=0;It<Vt;It+=1)Wt[Bt].pt.k[It].s&&(Wt[Bt].pt.k[It].s[0].c=Wt[Bt].cl),Wt[Bt].pt.k[It].e&&(Wt[Bt].pt.k[It].e[0].c=Wt[Bt].cl)}dt.ty===4&&_t(dt.shapes)}}return function(ut){if(ft(wt,ut.v)&&(St(ut.layers),ut.assets)){var dt,Mt=ut.assets.length;for(dt=0;dt<Mt;dt+=1)ut.assets[dt].layers&&St(ut.assets[dt].layers)}}}();function Pt(wt){wt.__complete||(gt(wt),pt(wt),yt(wt),vt(wt),Ct(wt),lt(wt.layers,wt.assets),_e(wt.chars,wt.assets),wt.__complete=!0)}function Tt(wt){wt.t.a.length===0&&"m"in wt.t.p}var Rt={};return Rt.completeData=Pt,Rt.checkColors=gt,Rt.checkChars=yt,Rt.checkPathProperties=vt,Rt.checkShapes=Ct,Rt.completeLayers=lt,Rt}if(d.dataManager||(d.dataManager=ot()),d.assetLoader||(d.assetLoader=function(){function lt(it){var nt=it.getResponseHeader("content-type");return nt&&it.responseType==="json"&&nt.indexOf("json")!==-1||it.response&&_typeof$5(it.response)==="object"?it.response:it.response&&typeof it.response=="string"?JSON.parse(it.response):it.responseText?JSON.parse(it.responseText):null}function _e(it,nt,ct,ht){var ft,pt=new XMLHttpRequest;try{pt.responseType="json"}catch{}pt.onreadystatechange=function(){if(pt.readyState===4)if(pt.status===200)ft=lt(pt),ct(ft);else try{ft=lt(pt),ct(ft)}catch(yt){ht&&ht(yt)}};try{pt.open(["G","E","T"].join(""),it,!0)}catch{pt.open(["G","E","T"].join(""),nt+"/"+it,!0)}pt.send()}return{load:_e}}()),st.data.type==="loadAnimation")d.assetLoader.load(st.data.path,st.data.fullPath,function(lt){d.dataManager.completeData(lt),d.postMessage({id:st.data.id,payload:lt,status:"success"})},function(){d.postMessage({id:st.data.id,status:"error"})});else if(st.data.type==="complete"){var at=st.data.animation;d.dataManager.completeData(at),d.postMessage({id:st.data.id,payload:at,status:"success"})}else st.data.type==="loadData"&&d.assetLoader.load(st.data.path,st.data.fullPath,function(lt){d.postMessage({id:st.data.id,payload:lt,status:"success"})},function(){d.postMessage({id:st.data.id,status:"error"})})}),o.onmessage=function(et){var st=et.data,ot=st.id,at=e[ot];e[ot]=null,st.status==="success"?at.onComplete(st.payload):at.onError&&at.onError()})}function b(et,st){s+=1;var ot="processId_"+s;return e[ot]={onComplete:et,onError:st},ot}function $(et,st,ot){_();var at=b(st,ot);o.postMessage({type:"loadAnimation",path:et,fullPath:window.location.origin+window.location.pathname,id:at})}function tt(et,st,ot){_();var at=b(st,ot);o.postMessage({type:"loadData",path:et,fullPath:window.location.origin+window.location.pathname,id:at})}function rt(et,st,ot){_();var at=b(st,ot);o.postMessage({type:"complete",animation:et,id:at})}return{loadAnimation:$,loadData:tt,completeAnimation:rt}}(),ImagePreloader=function(){var s=function(){var _e=createTag("canvas");_e.width=1,_e.height=1;var it=_e.getContext("2d");return it.fillStyle="rgba(0,0,0,0)",it.fillRect(0,0,1,1),_e}();function e(){this.loadedAssets+=1,this.loadedAssets===this.totalImages&&this.loadedFootagesCount===this.totalFootages&&this.imagesLoadedCb&&this.imagesLoadedCb(null)}function a(){this.loadedFootagesCount+=1,this.loadedAssets===this.totalImages&&this.loadedFootagesCount===this.totalFootages&&this.imagesLoadedCb&&this.imagesLoadedCb(null)}function o(_e,it,nt){var ct="";if(_e.e)ct=_e.p;else if(it){var ht=_e.p;ht.indexOf("images/")!==-1&&(ht=ht.split("/")[1]),ct=it+ht}else ct=nt,ct+=_e.u?_e.u:"",ct+=_e.p;return ct}function c(_e){var it=0,nt=setInterval((function(){var ct=_e.getBBox();(ct.width||it>500)&&(this._imageLoaded(),clearInterval(nt)),it+=1}).bind(this),50)}function d(_e){var it=o(_e,this.assetsPath,this.path),nt=createNS("image");isSafari?this.testImageLoaded(nt):nt.addEventListener("load",this._imageLoaded,!1),nt.addEventListener("error",(function(){ct.img=s,this._imageLoaded()}).bind(this),!1),nt.setAttributeNS("http://www.w3.org/1999/xlink","href",it),this._elementHelper.append?this._elementHelper.append(nt):this._elementHelper.appendChild(nt);var ct={img:nt,assetData:_e};return ct}function g(_e){var it=o(_e,this.assetsPath,this.path),nt=createTag("img");nt.crossOrigin="anonymous",nt.addEventListener("load",this._imageLoaded,!1),nt.addEventListener("error",(function(){ct.img=s,this._imageLoaded()}).bind(this),!1),nt.src=it;var ct={img:nt,assetData:_e};return ct}function _(_e){var it={assetData:_e},nt=o(_e,this.assetsPath,this.path);return dataManager.loadData(nt,(function(ct){it.img=ct,this._footageLoaded()}).bind(this),(function(){it.img={},this._footageLoaded()}).bind(this)),it}function b(_e,it){this.imagesLoadedCb=it;var nt,ct=_e.length;for(nt=0;nt<ct;nt+=1)_e[nt].layers||(!_e[nt].t||_e[nt].t==="seq"?(this.totalImages+=1,this.images.push(this._createImageData(_e[nt]))):_e[nt].t===3&&(this.totalFootages+=1,this.images.push(this.createFootageData(_e[nt]))))}function $(_e){this.path=_e||""}function tt(_e){this.assetsPath=_e||""}function rt(_e){for(var it=0,nt=this.images.length;it<nt;){if(this.images[it].assetData===_e)return this.images[it].img;it+=1}return null}function et(){this.imagesLoadedCb=null,this.images.length=0}function st(){return this.totalImages===this.loadedAssets}function ot(){return this.totalFootages===this.loadedFootagesCount}function at(_e,it){_e==="svg"?(this._elementHelper=it,this._createImageData=this.createImageData.bind(this)):this._createImageData=this.createImgData.bind(this)}function lt(){this._imageLoaded=e.bind(this),this._footageLoaded=a.bind(this),this.testImageLoaded=c.bind(this),this.createFootageData=_.bind(this),this.assetsPath="",this.path="",this.totalImages=0,this.totalFootages=0,this.loadedAssets=0,this.loadedFootagesCount=0,this.imagesLoadedCb=null,this.images=[]}return lt.prototype={loadAssets:b,setAssetsPath:tt,setPath:$,loadedImages:st,loadedFootages:ot,destroy:et,getAsset:rt,createImgData:g,createImageData:d,imageLoaded:e,footageLoaded:a,setCacheType:at},lt}();function BaseEvent(){}BaseEvent.prototype={triggerEvent:function(e,a){if(this._cbs[e])for(var o=this._cbs[e],c=0;c<o.length;c+=1)o[c](a)},addEventListener:function(e,a){return this._cbs[e]||(this._cbs[e]=[]),this._cbs[e].push(a),(function(){this.removeEventListener(e,a)}).bind(this)},removeEventListener:function(e,a){if(!a)this._cbs[e]=null;else if(this._cbs[e]){for(var o=0,c=this._cbs[e].length;o<c;)this._cbs[e][o]===a&&(this._cbs[e].splice(o,1),o-=1,c-=1),o+=1;this._cbs[e].length||(this._cbs[e]=null)}}};var markerParser=function(){function s(e){for(var a=e.split(`\r
`),o={},c,d=0,g=0;g<a.length;g+=1)c=a[g].split(":"),c.length===2&&(o[c[0]]=c[1].trim(),d+=1);if(d===0)throw new Error;return o}return function(e){for(var a=[],o=0;o<e.length;o+=1){var c=e[o],d={time:c.tm,duration:c.dr};try{d.payload=JSON.parse(e[o].cm)}catch{try{d.payload=s(e[o].cm)}catch{d.payload={name:e[o].cm}}}a.push(d)}return a}}(),ProjectInterface=function(){function s(e){this.compositions.push(e)}return function(){function e(a){for(var o=0,c=this.compositions.length;o<c;){if(this.compositions[o].data&&this.compositions[o].data.nm===a)return this.compositions[o].prepareFrame&&this.compositions[o].data.xt&&this.compositions[o].prepareFrame(this.currentFrame),this.compositions[o].compInterface;o+=1}return null}return e.compositions=[],e.currentFrame=0,e.registerComposition=s,e}}(),renderers={},registerRenderer=function(e,a){renderers[e]=a};function getRenderer(s){return renderers[s]}function getRegisteredRenderer(){if(renderers.canvas)return"canvas";for(var s in renderers)if(renderers[s])return s;return""}function _typeof$4(s){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?_typeof$4=function(a){return typeof a}:_typeof$4=function(a){return a&&typeof Symbol=="function"&&a.constructor===Symbol&&a!==Symbol.prototype?"symbol":typeof a},_typeof$4(s)}var AnimationItem=function(){this._cbs=[],this.name="",this.path="",this.isLoaded=!1,this.currentFrame=0,this.currentRawFrame=0,this.firstFrame=0,this.totalFrames=0,this.frameRate=0,this.frameMult=0,this.playSpeed=1,this.playDirection=1,this.playCount=0,this.animationData={},this.assets=[],this.isPaused=!0,this.autoplay=!1,this.loop=!0,this.renderer=null,this.animationID=createElementID(),this.assetsPath="",this.timeCompleted=0,this.segmentPos=0,this.isSubframeEnabled=getSubframeEnabled(),this.segments=[],this._idle=!0,this._completedLoop=!1,this.projectInterface=ProjectInterface(),this.imagePreloader=new ImagePreloader,this.audioController=audioControllerFactory(),this.markers=[],this.configAnimation=this.configAnimation.bind(this),this.onSetupError=this.onSetupError.bind(this),this.onSegmentComplete=this.onSegmentComplete.bind(this),this.drawnFrameEvent=new BMEnterFrameEvent("drawnFrame",0,0,0),this.expressionsPlugin=getExpressionsPlugin()};extendPrototype([BaseEvent],AnimationItem),AnimationItem.prototype.setParams=function(s){(s.wrapper||s.container)&&(this.wrapper=s.wrapper||s.container);var e="svg";s.animType?e=s.animType:s.renderer&&(e=s.renderer);var a=getRenderer(e);this.renderer=new a(this,s.rendererSettings),this.imagePreloader.setCacheType(e,this.renderer.globalData.defs),this.renderer.setProjectInterface(this.projectInterface),this.animType=e,s.loop===""||s.loop===null||s.loop===void 0||s.loop===!0?this.loop=!0:s.loop===!1?this.loop=!1:this.loop=parseInt(s.loop,10),this.autoplay="autoplay"in s?s.autoplay:!0,this.name=s.name?s.name:"",this.autoloadSegments=Object.prototype.hasOwnProperty.call(s,"autoloadSegments")?s.autoloadSegments:!0,this.assetsPath=s.assetsPath,this.initialSegment=s.initialSegment,s.audioFactory&&this.audioController.setAudioFactory(s.audioFactory),s.animationData?this.setupAnimation(s.animationData):s.path&&(s.path.lastIndexOf("\\")!==-1?this.path=s.path.substr(0,s.path.lastIndexOf("\\")+1):this.path=s.path.substr(0,s.path.lastIndexOf("/")+1),this.fileName=s.path.substr(s.path.lastIndexOf("/")+1),this.fileName=this.fileName.substr(0,this.fileName.lastIndexOf(".json")),dataManager.loadAnimation(s.path,this.configAnimation,this.onSetupError))},AnimationItem.prototype.onSetupError=function(){this.trigger("data_failed")},AnimationItem.prototype.setupAnimation=function(s){dataManager.completeAnimation(s,this.configAnimation)},AnimationItem.prototype.setData=function(s,e){e&&_typeof$4(e)!=="object"&&(e=JSON.parse(e));var a={wrapper:s,animationData:e},o=s.attributes;a.path=o.getNamedItem("data-animation-path")?o.getNamedItem("data-animation-path").value:o.getNamedItem("data-bm-path")?o.getNamedItem("data-bm-path").value:o.getNamedItem("bm-path")?o.getNamedItem("bm-path").value:"",a.animType=o.getNamedItem("data-anim-type")?o.getNamedItem("data-anim-type").value:o.getNamedItem("data-bm-type")?o.getNamedItem("data-bm-type").value:o.getNamedItem("bm-type")?o.getNamedItem("bm-type").value:o.getNamedItem("data-bm-renderer")?o.getNamedItem("data-bm-renderer").value:o.getNamedItem("bm-renderer")?o.getNamedItem("bm-renderer").value:getRegisteredRenderer()||"canvas";var c=o.getNamedItem("data-anim-loop")?o.getNamedItem("data-anim-loop").value:o.getNamedItem("data-bm-loop")?o.getNamedItem("data-bm-loop").value:o.getNamedItem("bm-loop")?o.getNamedItem("bm-loop").value:"";c==="false"?a.loop=!1:c==="true"?a.loop=!0:c!==""&&(a.loop=parseInt(c,10));var d=o.getNamedItem("data-anim-autoplay")?o.getNamedItem("data-anim-autoplay").value:o.getNamedItem("data-bm-autoplay")?o.getNamedItem("data-bm-autoplay").value:o.getNamedItem("bm-autoplay")?o.getNamedItem("bm-autoplay").value:!0;a.autoplay=d!=="false",a.name=o.getNamedItem("data-name")?o.getNamedItem("data-name").value:o.getNamedItem("data-bm-name")?o.getNamedItem("data-bm-name").value:o.getNamedItem("bm-name")?o.getNamedItem("bm-name").value:"";var g=o.getNamedItem("data-anim-prerender")?o.getNamedItem("data-anim-prerender").value:o.getNamedItem("data-bm-prerender")?o.getNamedItem("data-bm-prerender").value:o.getNamedItem("bm-prerender")?o.getNamedItem("bm-prerender").value:"";g==="false"&&(a.prerender=!1),a.path?this.setParams(a):this.trigger("destroy")},AnimationItem.prototype.includeLayers=function(s){s.op>this.animationData.op&&(this.animationData.op=s.op,this.totalFrames=Math.floor(s.op-this.animationData.ip));var e=this.animationData.layers,a,o=e.length,c=s.layers,d,g=c.length;for(d=0;d<g;d+=1)for(a=0;a<o;){if(e[a].id===c[d].id){e[a]=c[d];break}a+=1}if((s.chars||s.fonts)&&(this.renderer.globalData.fontManager.addChars(s.chars),this.renderer.globalData.fontManager.addFonts(s.fonts,this.renderer.globalData.defs)),s.assets)for(o=s.assets.length,a=0;a<o;a+=1)this.animationData.assets.push(s.assets[a]);this.animationData.__complete=!1,dataManager.completeAnimation(this.animationData,this.onSegmentComplete)},AnimationItem.prototype.onSegmentComplete=function(s){this.animationData=s;var e=getExpressionsPlugin();e&&e.initExpressions(this),this.loadNextSegment()},AnimationItem.prototype.loadNextSegment=function(){var s=this.animationData.segments;if(!s||s.length===0||!this.autoloadSegments){this.trigger("data_ready"),this.timeCompleted=this.totalFrames;return}var e=s.shift();this.timeCompleted=e.time*this.frameRate;var a=this.path+this.fileName+"_"+this.segmentPos+".json";this.segmentPos+=1,dataManager.loadData(a,this.includeLayers.bind(this),(function(){this.trigger("data_failed")}).bind(this))},AnimationItem.prototype.loadSegments=function(){var s=this.animationData.segments;s||(this.timeCompleted=this.totalFrames),this.loadNextSegment()},AnimationItem.prototype.imagesLoaded=function(){this.trigger("loaded_images"),this.checkLoaded()},AnimationItem.prototype.preloadImages=function(){this.imagePreloader.setAssetsPath(this.assetsPath),this.imagePreloader.setPath(this.path),this.imagePreloader.loadAssets(this.animationData.assets,this.imagesLoaded.bind(this))},AnimationItem.prototype.configAnimation=function(s){if(this.renderer)try{this.animationData=s,this.initialSegment?(this.totalFrames=Math.floor(this.initialSegment[1]-this.initialSegment[0]),this.firstFrame=Math.round(this.initialSegment[0])):(this.totalFrames=Math.floor(this.animationData.op-this.animationData.ip),this.firstFrame=Math.round(this.animationData.ip)),this.renderer.configAnimation(s),s.assets||(s.assets=[]),this.assets=this.animationData.assets,this.frameRate=this.animationData.fr,this.frameMult=this.animationData.fr/1e3,this.renderer.searchExtraCompositions(s.assets),this.markers=markerParser(s.markers||[]),this.trigger("config_ready"),this.preloadImages(),this.loadSegments(),this.updaFrameModifier(),this.waitForFontsLoaded(),this.isPaused&&this.audioController.pause()}catch(e){this.triggerConfigError(e)}},AnimationItem.prototype.waitForFontsLoaded=function(){this.renderer&&(this.renderer.globalData.fontManager.isLoaded?this.checkLoaded():setTimeout(this.waitForFontsLoaded.bind(this),20))},AnimationItem.prototype.checkLoaded=function(){if(!this.isLoaded&&this.renderer.globalData.fontManager.isLoaded&&(this.imagePreloader.loadedImages()||this.renderer.rendererType!=="canvas")&&this.imagePreloader.loadedFootages()){this.isLoaded=!0;var s=getExpressionsPlugin();s&&s.initExpressions(this),this.renderer.initItems(),setTimeout((function(){this.trigger("DOMLoaded")}).bind(this),0),this.gotoFrame(),this.autoplay&&this.play()}},AnimationItem.prototype.resize=function(s,e){var a=typeof s=="number"?s:void 0,o=typeof e=="number"?e:void 0;this.renderer.updateContainerSize(a,o)},AnimationItem.prototype.setSubframe=function(s){this.isSubframeEnabled=!!s},AnimationItem.prototype.gotoFrame=function(){this.currentFrame=this.isSubframeEnabled?this.currentRawFrame:~~this.currentRawFrame,this.timeCompleted!==this.totalFrames&&this.currentFrame>this.timeCompleted&&(this.currentFrame=this.timeCompleted),this.trigger("enterFrame"),this.renderFrame(),this.trigger("drawnFrame")},AnimationItem.prototype.renderFrame=function(){if(!(this.isLoaded===!1||!this.renderer))try{this.expressionsPlugin&&this.expressionsPlugin.resetFrame(),this.renderer.renderFrame(this.currentFrame+this.firstFrame)}catch(s){this.triggerRenderFrameError(s)}},AnimationItem.prototype.play=function(s){s&&this.name!==s||this.isPaused===!0&&(this.isPaused=!1,this.trigger("_play"),this.audioController.resume(),this._idle&&(this._idle=!1,this.trigger("_active")))},AnimationItem.prototype.pause=function(s){s&&this.name!==s||this.isPaused===!1&&(this.isPaused=!0,this.trigger("_pause"),this._idle=!0,this.trigger("_idle"),this.audioController.pause())},AnimationItem.prototype.togglePause=function(s){s&&this.name!==s||(this.isPaused===!0?this.play():this.pause())},AnimationItem.prototype.stop=function(s){s&&this.name!==s||(this.pause(),this.playCount=0,this._completedLoop=!1,this.setCurrentRawFrameValue(0))},AnimationItem.prototype.getMarkerData=function(s){for(var e,a=0;a<this.markers.length;a+=1)if(e=this.markers[a],e.payload&&e.payload.name===s)return e;return null},AnimationItem.prototype.goToAndStop=function(s,e,a){if(!(a&&this.name!==a)){var o=Number(s);if(isNaN(o)){var c=this.getMarkerData(s);c&&this.goToAndStop(c.time,!0)}else e?this.setCurrentRawFrameValue(s):this.setCurrentRawFrameValue(s*this.frameModifier);this.pause()}},AnimationItem.prototype.goToAndPlay=function(s,e,a){if(!(a&&this.name!==a)){var o=Number(s);if(isNaN(o)){var c=this.getMarkerData(s);c&&(c.duration?this.playSegments([c.time,c.time+c.duration],!0):this.goToAndStop(c.time,!0))}else this.goToAndStop(o,e,a);this.play()}},AnimationItem.prototype.advanceTime=function(s){if(!(this.isPaused===!0||this.isLoaded===!1)){var e=this.currentRawFrame+s*this.frameModifier,a=!1;e>=this.totalFrames-1&&this.frameModifier>0?!this.loop||this.playCount===this.loop?this.checkSegments(e>this.totalFrames?e%this.totalFrames:0)||(a=!0,e=this.totalFrames-1):e>=this.totalFrames?(this.playCount+=1,this.checkSegments(e%this.totalFrames)||(this.setCurrentRawFrameValue(e%this.totalFrames),this._completedLoop=!0,this.trigger("loopComplete"))):this.setCurrentRawFrameValue(e):e<0?this.checkSegments(e%this.totalFrames)||(this.loop&&!(this.playCount--<=0&&this.loop!==!0)?(this.setCurrentRawFrameValue(this.totalFrames+e%this.totalFrames),this._completedLoop?this.trigger("loopComplete"):this._completedLoop=!0):(a=!0,e=0)):this.setCurrentRawFrameValue(e),a&&(this.setCurrentRawFrameValue(e),this.pause(),this.trigger("complete"))}},AnimationItem.prototype.adjustSegment=function(s,e){this.playCount=0,s[1]<s[0]?(this.frameModifier>0&&(this.playSpeed<0?this.setSpeed(-this.playSpeed):this.setDirection(-1)),this.totalFrames=s[0]-s[1],this.timeCompleted=this.totalFrames,this.firstFrame=s[1],this.setCurrentRawFrameValue(this.totalFrames-.001-e)):s[1]>s[0]&&(this.frameModifier<0&&(this.playSpeed<0?this.setSpeed(-this.playSpeed):this.setDirection(1)),this.totalFrames=s[1]-s[0],this.timeCompleted=this.totalFrames,this.firstFrame=s[0],this.setCurrentRawFrameValue(.001+e)),this.trigger("segmentStart")},AnimationItem.prototype.setSegment=function(s,e){var a=-1;this.isPaused&&(this.currentRawFrame+this.firstFrame<s?a=s:this.currentRawFrame+this.firstFrame>e&&(a=e-s)),this.firstFrame=s,this.totalFrames=e-s,this.timeCompleted=this.totalFrames,a!==-1&&this.goToAndStop(a,!0)},AnimationItem.prototype.playSegments=function(s,e){if(e&&(this.segments.length=0),_typeof$4(s[0])==="object"){var a,o=s.length;for(a=0;a<o;a+=1)this.segments.push(s[a])}else this.segments.push(s);this.segments.length&&e&&this.adjustSegment(this.segments.shift(),0),this.isPaused&&this.play()},AnimationItem.prototype.resetSegments=function(s){this.segments.length=0,this.segments.push([this.animationData.ip,this.animationData.op]),s&&this.checkSegments(0)},AnimationItem.prototype.checkSegments=function(s){return this.segments.length?(this.adjustSegment(this.segments.shift(),s),!0):!1},AnimationItem.prototype.destroy=function(s){s&&this.name!==s||!this.renderer||(this.renderer.destroy(),this.imagePreloader.destroy(),this.trigger("destroy"),this._cbs=null,this.onEnterFrame=null,this.onLoopComplete=null,this.onComplete=null,this.onSegmentStart=null,this.onDestroy=null,this.renderer=null,this.expressionsPlugin=null,this.imagePreloader=null,this.projectInterface=null)},AnimationItem.prototype.setCurrentRawFrameValue=function(s){this.currentRawFrame=s,this.gotoFrame()},AnimationItem.prototype.setSpeed=function(s){this.playSpeed=s,this.updaFrameModifier()},AnimationItem.prototype.setDirection=function(s){this.playDirection=s<0?-1:1,this.updaFrameModifier()},AnimationItem.prototype.setLoop=function(s){this.loop=s},AnimationItem.prototype.setVolume=function(s,e){e&&this.name!==e||this.audioController.setVolume(s)},AnimationItem.prototype.getVolume=function(){return this.audioController.getVolume()},AnimationItem.prototype.mute=function(s){s&&this.name!==s||this.audioController.mute()},AnimationItem.prototype.unmute=function(s){s&&this.name!==s||this.audioController.unmute()},AnimationItem.prototype.updaFrameModifier=function(){this.frameModifier=this.frameMult*this.playSpeed*this.playDirection,this.audioController.setRate(this.playSpeed*this.playDirection)},AnimationItem.prototype.getPath=function(){return this.path},AnimationItem.prototype.getAssetsPath=function(s){var e="";if(s.e)e=s.p;else if(this.assetsPath){var a=s.p;a.indexOf("images/")!==-1&&(a=a.split("/")[1]),e=this.assetsPath+a}else e=this.path,e+=s.u?s.u:"",e+=s.p;return e},AnimationItem.prototype.getAssetData=function(s){for(var e=0,a=this.assets.length;e<a;){if(s===this.assets[e].id)return this.assets[e];e+=1}return null},AnimationItem.prototype.hide=function(){this.renderer.hide()},AnimationItem.prototype.show=function(){this.renderer.show()},AnimationItem.prototype.getDuration=function(s){return s?this.totalFrames:this.totalFrames/this.frameRate},AnimationItem.prototype.updateDocumentData=function(s,e,a){try{var o=this.renderer.getElementByPath(s);o.updateDocumentData(e,a)}catch{}},AnimationItem.prototype.trigger=function(s){if(this._cbs&&this._cbs[s])switch(s){case"enterFrame":this.triggerEvent(s,new BMEnterFrameEvent(s,this.currentFrame,this.totalFrames,this.frameModifier));break;case"drawnFrame":this.drawnFrameEvent.currentTime=this.currentFrame,this.drawnFrameEvent.totalTime=this.totalFrames,this.drawnFrameEvent.direction=this.frameModifier,this.triggerEvent(s,this.drawnFrameEvent);break;case"loopComplete":this.triggerEvent(s,new BMCompleteLoopEvent(s,this.loop,this.playCount,this.frameMult));break;case"complete":this.triggerEvent(s,new BMCompleteEvent(s,this.frameMult));break;case"segmentStart":this.triggerEvent(s,new BMSegmentStartEvent(s,this.firstFrame,this.totalFrames));break;case"destroy":this.triggerEvent(s,new BMDestroyEvent(s,this));break;default:this.triggerEvent(s)}s==="enterFrame"&&this.onEnterFrame&&this.onEnterFrame.call(this,new BMEnterFrameEvent(s,this.currentFrame,this.totalFrames,this.frameMult)),s==="loopComplete"&&this.onLoopComplete&&this.onLoopComplete.call(this,new BMCompleteLoopEvent(s,this.loop,this.playCount,this.frameMult)),s==="complete"&&this.onComplete&&this.onComplete.call(this,new BMCompleteEvent(s,this.frameMult)),s==="segmentStart"&&this.onSegmentStart&&this.onSegmentStart.call(this,new BMSegmentStartEvent(s,this.firstFrame,this.totalFrames)),s==="destroy"&&this.onDestroy&&this.onDestroy.call(this,new BMDestroyEvent(s,this))},AnimationItem.prototype.triggerRenderFrameError=function(s){var e=new BMRenderFrameErrorEvent(s,this.currentFrame);this.triggerEvent("error",e),this.onError&&this.onError.call(this,e)},AnimationItem.prototype.triggerConfigError=function(s){var e=new BMConfigErrorEvent(s,this.currentFrame);this.triggerEvent("error",e),this.onError&&this.onError.call(this,e)};var animationManager=function(){var s={},e=[],a=0,o=0,c=0,d=!0,g=!1;function _(_t){for(var St=0,ut=_t.target;St<o;)e[St].animation===ut&&(e.splice(St,1),St-=1,o-=1,ut.isPaused||rt()),St+=1}function b(_t,St){if(!_t)return null;for(var ut=0;ut<o;){if(e[ut].elem===_t&&e[ut].elem!==null)return e[ut].animation;ut+=1}var dt=new AnimationItem;return et(dt,_t),dt.setData(_t,St),dt}function $(){var _t,St=e.length,ut=[];for(_t=0;_t<St;_t+=1)ut.push(e[_t].animation);return ut}function tt(){c+=1,gt()}function rt(){c-=1}function et(_t,St){_t.addEventListener("destroy",_),_t.addEventListener("_active",tt),_t.addEventListener("_idle",rt),e.push({elem:St,animation:_t}),o+=1}function st(_t){var St=new AnimationItem;return et(St,null),St.setParams(_t),St}function ot(_t,St){var ut;for(ut=0;ut<o;ut+=1)e[ut].animation.setSpeed(_t,St)}function at(_t,St){var ut;for(ut=0;ut<o;ut+=1)e[ut].animation.setDirection(_t,St)}function lt(_t){var St;for(St=0;St<o;St+=1)e[St].animation.play(_t)}function _e(_t){var St=_t-a,ut;for(ut=0;ut<o;ut+=1)e[ut].animation.advanceTime(St);a=_t,c&&!g?window.requestAnimationFrame(_e):d=!0}function it(_t){a=_t,window.requestAnimationFrame(_e)}function nt(_t){var St;for(St=0;St<o;St+=1)e[St].animation.pause(_t)}function ct(_t,St,ut){var dt;for(dt=0;dt<o;dt+=1)e[dt].animation.goToAndStop(_t,St,ut)}function ht(_t){var St;for(St=0;St<o;St+=1)e[St].animation.stop(_t)}function ft(_t){var St;for(St=0;St<o;St+=1)e[St].animation.togglePause(_t)}function pt(_t){var St;for(St=o-1;St>=0;St-=1)e[St].animation.destroy(_t)}function yt(_t,St,ut){var dt=[].concat([].slice.call(document.getElementsByClassName("lottie")),[].slice.call(document.getElementsByClassName("bodymovin"))),Mt,At=dt.length;for(Mt=0;Mt<At;Mt+=1)ut&&dt[Mt].setAttribute("data-bm-type",ut),b(dt[Mt],_t);if(St&&At===0){ut||(ut="svg");var Bt=document.getElementsByTagName("body")[0];Bt.innerText="";var Xt=createTag("div");Xt.style.width="100%",Xt.style.height="100%",Xt.setAttribute("data-bm-type",ut),Bt.appendChild(Xt),b(Xt,_t)}}function vt(){var _t;for(_t=0;_t<o;_t+=1)e[_t].animation.resize()}function gt(){!g&&c&&d&&(window.requestAnimationFrame(it),d=!1)}function Ct(){g=!0}function Pt(){g=!1,gt()}function Tt(_t,St){var ut;for(ut=0;ut<o;ut+=1)e[ut].animation.setVolume(_t,St)}function Rt(_t){var St;for(St=0;St<o;St+=1)e[St].animation.mute(_t)}function wt(_t){var St;for(St=0;St<o;St+=1)e[St].animation.unmute(_t)}return s.registerAnimation=b,s.loadAnimation=st,s.setSpeed=ot,s.setDirection=at,s.play=lt,s.pause=nt,s.stop=ht,s.togglePause=ft,s.searchAnimations=yt,s.resize=vt,s.goToAndStop=ct,s.destroy=pt,s.freeze=Ct,s.unfreeze=Pt,s.setVolume=Tt,s.mute=Rt,s.unmute=wt,s.getRegisteredAnimations=$,s}(),BezierFactory=function(){var s={};s.getBezierEasing=a;var e={};function a(it,nt,ct,ht,ft){var pt=ft||("bez_"+it+"_"+nt+"_"+ct+"_"+ht).replace(/\./g,"p");if(e[pt])return e[pt];var yt=new _e([it,nt,ct,ht]);return e[pt]=yt,yt}var o=4,c=.001,d=1e-7,g=10,_=11,b=1/(_-1),$=typeof Float32Array=="function";function tt(it,nt){return 1-3*nt+3*it}function rt(it,nt){return 3*nt-6*it}function et(it){return 3*it}function st(it,nt,ct){return((tt(nt,ct)*it+rt(nt,ct))*it+et(nt))*it}function ot(it,nt,ct){return 3*tt(nt,ct)*it*it+2*rt(nt,ct)*it+et(nt)}function at(it,nt,ct,ht,ft){var pt,yt,vt=0;do yt=nt+(ct-nt)/2,pt=st(yt,ht,ft)-it,pt>0?ct=yt:nt=yt;while(Math.abs(pt)>d&&++vt<g);return yt}function lt(it,nt,ct,ht){for(var ft=0;ft<o;++ft){var pt=ot(nt,ct,ht);if(pt===0)return nt;var yt=st(nt,ct,ht)-it;nt-=yt/pt}return nt}function _e(it){this._p=it,this._mSampleValues=$?new Float32Array(_):new Array(_),this._precomputed=!1,this.get=this.get.bind(this)}return _e.prototype={get:function(nt){var ct=this._p[0],ht=this._p[1],ft=this._p[2],pt=this._p[3];return this._precomputed||this._precompute(),ct===ht&&ft===pt?nt:nt===0?0:nt===1?1:st(this._getTForX(nt),ht,pt)},_precompute:function(){var nt=this._p[0],ct=this._p[1],ht=this._p[2],ft=this._p[3];this._precomputed=!0,(nt!==ct||ht!==ft)&&this._calcSampleValues()},_calcSampleValues:function(){for(var nt=this._p[0],ct=this._p[2],ht=0;ht<_;++ht)this._mSampleValues[ht]=st(ht*b,nt,ct)},_getTForX:function(nt){for(var ct=this._p[0],ht=this._p[2],ft=this._mSampleValues,pt=0,yt=1,vt=_-1;yt!==vt&&ft[yt]<=nt;++yt)pt+=b;--yt;var gt=(nt-ft[yt])/(ft[yt+1]-ft[yt]),Ct=pt+gt*b,Pt=ot(Ct,ct,ht);return Pt>=c?lt(nt,Ct,ct,ht):Pt===0?Ct:at(nt,pt,pt+b,ct,ht)}},s}(),pooling=function(){function s(e){return e.concat(createSizedArray(e.length))}return{double:s}}(),poolFactory=function(){return function(s,e,a){var o=0,c=s,d=createSizedArray(c),g={newElement:_,release:b};function _(){var $;return o?(o-=1,$=d[o]):$=e(),$}function b($){o===c&&(d=pooling.double(d),c*=2),a&&a($),d[o]=$,o+=1}return g}}(),bezierLengthPool=function(){function s(){return{addedLength:0,percents:createTypedArray("float32",getDefaultCurveSegments()),lengths:createTypedArray("float32",getDefaultCurveSegments())}}return poolFactory(8,s)}(),segmentsLengthPool=function(){function s(){return{lengths:[],totalLength:0}}function e(a){var o,c=a.lengths.length;for(o=0;o<c;o+=1)bezierLengthPool.release(a.lengths[o]);a.lengths.length=0}return poolFactory(8,s,e)}();function bezFunction(){var s=Math;function e(et,st,ot,at,lt,_e){var it=et*at+st*lt+ot*_e-lt*at-_e*et-ot*st;return it>-.001&&it<.001}function a(et,st,ot,at,lt,_e,it,nt,ct){if(ot===0&&_e===0&&ct===0)return e(et,st,at,lt,it,nt);var ht=s.sqrt(s.pow(at-et,2)+s.pow(lt-st,2)+s.pow(_e-ot,2)),ft=s.sqrt(s.pow(it-et,2)+s.pow(nt-st,2)+s.pow(ct-ot,2)),pt=s.sqrt(s.pow(it-at,2)+s.pow(nt-lt,2)+s.pow(ct-_e,2)),yt;return ht>ft?ht>pt?yt=ht-ft-pt:yt=pt-ft-ht:pt>ft?yt=pt-ft-ht:yt=ft-ht-pt,yt>-1e-4&&yt<1e-4}var o=function(){return function(et,st,ot,at){var lt=getDefaultCurveSegments(),_e,it,nt,ct,ht,ft=0,pt,yt=[],vt=[],gt=bezierLengthPool.newElement();for(nt=ot.length,_e=0;_e<lt;_e+=1){for(ht=_e/(lt-1),pt=0,it=0;it<nt;it+=1)ct=bmPow(1-ht,3)*et[it]+3*bmPow(1-ht,2)*ht*ot[it]+3*(1-ht)*bmPow(ht,2)*at[it]+bmPow(ht,3)*st[it],yt[it]=ct,vt[it]!==null&&(pt+=bmPow(yt[it]-vt[it],2)),vt[it]=yt[it];pt&&(pt=bmSqrt(pt),ft+=pt),gt.percents[_e]=ht,gt.lengths[_e]=ft}return gt.addedLength=ft,gt}}();function c(et){var st=segmentsLengthPool.newElement(),ot=et.c,at=et.v,lt=et.o,_e=et.i,it,nt=et._length,ct=st.lengths,ht=0;for(it=0;it<nt-1;it+=1)ct[it]=o(at[it],at[it+1],lt[it],_e[it+1]),ht+=ct[it].addedLength;return ot&&nt&&(ct[it]=o(at[it],at[0],lt[it],_e[0]),ht+=ct[it].addedLength),st.totalLength=ht,st}function d(et){this.segmentLength=0,this.points=new Array(et)}function g(et,st){this.partialLength=et,this.point=st}var _=function(){var et={};return function(st,ot,at,lt){var _e=(st[0]+"_"+st[1]+"_"+ot[0]+"_"+ot[1]+"_"+at[0]+"_"+at[1]+"_"+lt[0]+"_"+lt[1]).replace(/\./g,"p");if(!et[_e]){var it=getDefaultCurveSegments(),nt,ct,ht,ft,pt,yt=0,vt,gt,Ct=null;st.length===2&&(st[0]!==ot[0]||st[1]!==ot[1])&&e(st[0],st[1],ot[0],ot[1],st[0]+at[0],st[1]+at[1])&&e(st[0],st[1],ot[0],ot[1],ot[0]+lt[0],ot[1]+lt[1])&&(it=2);var Pt=new d(it);for(ht=at.length,nt=0;nt<it;nt+=1){for(gt=createSizedArray(ht),pt=nt/(it-1),vt=0,ct=0;ct<ht;ct+=1)ft=bmPow(1-pt,3)*st[ct]+3*bmPow(1-pt,2)*pt*(st[ct]+at[ct])+3*(1-pt)*bmPow(pt,2)*(ot[ct]+lt[ct])+bmPow(pt,3)*ot[ct],gt[ct]=ft,Ct!==null&&(vt+=bmPow(gt[ct]-Ct[ct],2));vt=bmSqrt(vt),yt+=vt,Pt.points[nt]=new g(vt,gt),Ct=gt}Pt.segmentLength=yt,et[_e]=Pt}return et[_e]}}();function b(et,st){var ot=st.percents,at=st.lengths,lt=ot.length,_e=bmFloor((lt-1)*et),it=et*st.addedLength,nt=0;if(_e===lt-1||_e===0||it===at[_e])return ot[_e];for(var ct=at[_e]>it?-1:1,ht=!0;ht;)if(at[_e]<=it&&at[_e+1]>it?(nt=(it-at[_e])/(at[_e+1]-at[_e]),ht=!1):_e+=ct,_e<0||_e>=lt-1){if(_e===lt-1)return ot[_e];ht=!1}return ot[_e]+(ot[_e+1]-ot[_e])*nt}function $(et,st,ot,at,lt,_e){var it=b(lt,_e),nt=1-it,ct=s.round((nt*nt*nt*et[0]+(it*nt*nt+nt*it*nt+nt*nt*it)*ot[0]+(it*it*nt+nt*it*it+it*nt*it)*at[0]+it*it*it*st[0])*1e3)/1e3,ht=s.round((nt*nt*nt*et[1]+(it*nt*nt+nt*it*nt+nt*nt*it)*ot[1]+(it*it*nt+nt*it*it+it*nt*it)*at[1]+it*it*it*st[1])*1e3)/1e3;return[ct,ht]}var tt=createTypedArray("float32",8);function rt(et,st,ot,at,lt,_e,it){lt<0?lt=0:lt>1&&(lt=1);var nt=b(lt,it);_e=_e>1?1:_e;var ct=b(_e,it),ht,ft=et.length,pt=1-nt,yt=1-ct,vt=pt*pt*pt,gt=nt*pt*pt*3,Ct=nt*nt*pt*3,Pt=nt*nt*nt,Tt=pt*pt*yt,Rt=nt*pt*yt+pt*nt*yt+pt*pt*ct,wt=nt*nt*yt+pt*nt*ct+nt*pt*ct,_t=nt*nt*ct,St=pt*yt*yt,ut=nt*yt*yt+pt*ct*yt+pt*yt*ct,dt=nt*ct*yt+pt*ct*ct+nt*yt*ct,Mt=nt*ct*ct,At=yt*yt*yt,Bt=ct*yt*yt+yt*ct*yt+yt*yt*ct,Xt=ct*ct*yt+yt*ct*ct+ct*yt*ct,It=ct*ct*ct;for(ht=0;ht<ft;ht+=1)tt[ht*4]=s.round((vt*et[ht]+gt*ot[ht]+Ct*at[ht]+Pt*st[ht])*1e3)/1e3,tt[ht*4+1]=s.round((Tt*et[ht]+Rt*ot[ht]+wt*at[ht]+_t*st[ht])*1e3)/1e3,tt[ht*4+2]=s.round((St*et[ht]+ut*ot[ht]+dt*at[ht]+Mt*st[ht])*1e3)/1e3,tt[ht*4+3]=s.round((At*et[ht]+Bt*ot[ht]+Xt*at[ht]+It*st[ht])*1e3)/1e3;return tt}return{getSegmentsLength:c,getNewSegment:rt,getPointInSegment:$,buildBezierData:_,pointOnLine2D:e,pointOnLine3D:a}}var bez=bezFunction(),initFrame=initialDefaultFrame,mathAbs=Math.abs;function interpolateValue(s,e){var a=this.offsetTime,o;this.propType==="multidimensional"&&(o=createTypedArray("float32",this.pv.length));for(var c=e.lastIndex,d=c,g=this.keyframes.length-1,_=!0,b,$,tt;_;){if(b=this.keyframes[d],$=this.keyframes[d+1],d===g-1&&s>=$.t-a){b.h&&(b=$),c=0;break}if($.t-a>s){c=d;break}d<g-1?d+=1:(c=0,_=!1)}tt=this.keyframesMetadata[d]||{};var rt,et,st,ot,at,lt,_e=$.t-a,it=b.t-a,nt;if(b.to){tt.bezierData||(tt.bezierData=bez.buildBezierData(b.s,$.s||b.e,b.to,b.ti));var ct=tt.bezierData;if(s>=_e||s<it){var ht=s>=_e?ct.points.length-1:0;for(et=ct.points[ht].point.length,rt=0;rt<et;rt+=1)o[rt]=ct.points[ht].point[rt]}else{tt.__fnct?lt=tt.__fnct:(lt=BezierFactory.getBezierEasing(b.o.x,b.o.y,b.i.x,b.i.y,b.n).get,tt.__fnct=lt),st=lt((s-it)/(_e-it));var ft=ct.segmentLength*st,pt,yt=e.lastFrame<s&&e._lastKeyframeIndex===d?e._lastAddedLength:0;for(at=e.lastFrame<s&&e._lastKeyframeIndex===d?e._lastPoint:0,_=!0,ot=ct.points.length;_;){if(yt+=ct.points[at].partialLength,ft===0||st===0||at===ct.points.length-1){for(et=ct.points[at].point.length,rt=0;rt<et;rt+=1)o[rt]=ct.points[at].point[rt];break}else if(ft>=yt&&ft<yt+ct.points[at+1].partialLength){for(pt=(ft-yt)/ct.points[at+1].partialLength,et=ct.points[at].point.length,rt=0;rt<et;rt+=1)o[rt]=ct.points[at].point[rt]+(ct.points[at+1].point[rt]-ct.points[at].point[rt])*pt;break}at<ot-1?at+=1:_=!1}e._lastPoint=at,e._lastAddedLength=yt-ct.points[at].partialLength,e._lastKeyframeIndex=d}}else{var vt,gt,Ct,Pt,Tt;if(g=b.s.length,nt=$.s||b.e,this.sh&&b.h!==1)if(s>=_e)o[0]=nt[0],o[1]=nt[1],o[2]=nt[2];else if(s<=it)o[0]=b.s[0],o[1]=b.s[1],o[2]=b.s[2];else{var Rt=createQuaternion(b.s),wt=createQuaternion(nt),_t=(s-it)/(_e-it);quaternionToEuler(o,slerp(Rt,wt,_t))}else for(d=0;d<g;d+=1)b.h!==1&&(s>=_e?st=1:s<it?st=0:(b.o.x.constructor===Array?(tt.__fnct||(tt.__fnct=[]),tt.__fnct[d]?lt=tt.__fnct[d]:(vt=b.o.x[d]===void 0?b.o.x[0]:b.o.x[d],gt=b.o.y[d]===void 0?b.o.y[0]:b.o.y[d],Ct=b.i.x[d]===void 0?b.i.x[0]:b.i.x[d],Pt=b.i.y[d]===void 0?b.i.y[0]:b.i.y[d],lt=BezierFactory.getBezierEasing(vt,gt,Ct,Pt).get,tt.__fnct[d]=lt)):tt.__fnct?lt=tt.__fnct:(vt=b.o.x,gt=b.o.y,Ct=b.i.x,Pt=b.i.y,lt=BezierFactory.getBezierEasing(vt,gt,Ct,Pt).get,b.keyframeMetadata=lt),st=lt((s-it)/(_e-it)))),nt=$.s||b.e,Tt=b.h===1?b.s[d]:b.s[d]+(nt[d]-b.s[d])*st,this.propType==="multidimensional"?o[d]=Tt:o=Tt}return e.lastIndex=c,o}function slerp(s,e,a){var o=[],c=s[0],d=s[1],g=s[2],_=s[3],b=e[0],$=e[1],tt=e[2],rt=e[3],et,st,ot,at,lt;return st=c*b+d*$+g*tt+_*rt,st<0&&(st=-st,b=-b,$=-$,tt=-tt,rt=-rt),1-st>1e-6?(et=Math.acos(st),ot=Math.sin(et),at=Math.sin((1-a)*et)/ot,lt=Math.sin(a*et)/ot):(at=1-a,lt=a),o[0]=at*c+lt*b,o[1]=at*d+lt*$,o[2]=at*g+lt*tt,o[3]=at*_+lt*rt,o}function quaternionToEuler(s,e){var a=e[0],o=e[1],c=e[2],d=e[3],g=Math.atan2(2*o*d-2*a*c,1-2*o*o-2*c*c),_=Math.asin(2*a*o+2*c*d),b=Math.atan2(2*a*d-2*o*c,1-2*a*a-2*c*c);s[0]=g/degToRads,s[1]=_/degToRads,s[2]=b/degToRads}function createQuaternion(s){var e=s[0]*degToRads,a=s[1]*degToRads,o=s[2]*degToRads,c=Math.cos(e/2),d=Math.cos(a/2),g=Math.cos(o/2),_=Math.sin(e/2),b=Math.sin(a/2),$=Math.sin(o/2),tt=c*d*g-_*b*$,rt=_*b*g+c*d*$,et=_*d*g+c*b*$,st=c*b*g-_*d*$;return[rt,et,st,tt]}function getValueAtCurrentTime(){var s=this.comp.renderedFrame-this.offsetTime,e=this.keyframes[0].t-this.offsetTime,a=this.keyframes[this.keyframes.length-1].t-this.offsetTime;if(!(s===this._caching.lastFrame||this._caching.lastFrame!==initFrame&&(this._caching.lastFrame>=a&&s>=a||this._caching.lastFrame<e&&s<e))){this._caching.lastFrame>=s&&(this._caching._lastKeyframeIndex=-1,this._caching.lastIndex=0);var o=this.interpolateValue(s,this._caching);this.pv=o}return this._caching.lastFrame=s,this.pv}function setVValue(s){var e;if(this.propType==="unidimensional")e=s*this.mult,mathAbs(this.v-e)>1e-5&&(this.v=e,this._mdf=!0);else for(var a=0,o=this.v.length;a<o;)e=s[a]*this.mult,mathAbs(this.v[a]-e)>1e-5&&(this.v[a]=e,this._mdf=!0),a+=1}function processEffectsSequence(){if(!(this.elem.globalData.frameId===this.frameId||!this.effectsSequence.length)){if(this.lock){this.setVValue(this.pv);return}this.lock=!0,this._mdf=this._isFirstFrame;var s,e=this.effectsSequence.length,a=this.kf?this.pv:this.data.k;for(s=0;s<e;s+=1)a=this.effectsSequence[s](a);this.setVValue(a),this._isFirstFrame=!1,this.lock=!1,this.frameId=this.elem.globalData.frameId}}function addEffect(s){this.effectsSequence.push(s),this.container.addDynamicProperty(this)}function ValueProperty(s,e,a,o){this.propType="unidimensional",this.mult=a||1,this.data=e,this.v=a?e.k*a:e.k,this.pv=e.k,this._mdf=!1,this.elem=s,this.container=o,this.comp=s.comp,this.k=!1,this.kf=!1,this.vel=0,this.effectsSequence=[],this._isFirstFrame=!0,this.getValue=processEffectsSequence,this.setVValue=setVValue,this.addEffect=addEffect}function MultiDimensionalProperty(s,e,a,o){this.propType="multidimensional",this.mult=a||1,this.data=e,this._mdf=!1,this.elem=s,this.container=o,this.comp=s.comp,this.k=!1,this.kf=!1,this.frameId=-1;var c,d=e.k.length;for(this.v=createTypedArray("float32",d),this.pv=createTypedArray("float32",d),this.vel=createTypedArray("float32",d),c=0;c<d;c+=1)this.v[c]=e.k[c]*this.mult,this.pv[c]=e.k[c];this._isFirstFrame=!0,this.effectsSequence=[],this.getValue=processEffectsSequence,this.setVValue=setVValue,this.addEffect=addEffect}function KeyframedValueProperty(s,e,a,o){this.propType="unidimensional",this.keyframes=e.k,this.keyframesMetadata=[],this.offsetTime=s.data.st,this.frameId=-1,this._caching={lastFrame:initFrame,lastIndex:0,value:0,_lastKeyframeIndex:-1},this.k=!0,this.kf=!0,this.data=e,this.mult=a||1,this.elem=s,this.container=o,this.comp=s.comp,this.v=initFrame,this.pv=initFrame,this._isFirstFrame=!0,this.getValue=processEffectsSequence,this.setVValue=setVValue,this.interpolateValue=interpolateValue,this.effectsSequence=[getValueAtCurrentTime.bind(this)],this.addEffect=addEffect}function KeyframedMultidimensionalProperty(s,e,a,o){this.propType="multidimensional";var c,d=e.k.length,g,_,b,$;for(c=0;c<d-1;c+=1)e.k[c].to&&e.k[c].s&&e.k[c+1]&&e.k[c+1].s&&(g=e.k[c].s,_=e.k[c+1].s,b=e.k[c].to,$=e.k[c].ti,(g.length===2&&!(g[0]===_[0]&&g[1]===_[1])&&bez.pointOnLine2D(g[0],g[1],_[0],_[1],g[0]+b[0],g[1]+b[1])&&bez.pointOnLine2D(g[0],g[1],_[0],_[1],_[0]+$[0],_[1]+$[1])||g.length===3&&!(g[0]===_[0]&&g[1]===_[1]&&g[2]===_[2])&&bez.pointOnLine3D(g[0],g[1],g[2],_[0],_[1],_[2],g[0]+b[0],g[1]+b[1],g[2]+b[2])&&bez.pointOnLine3D(g[0],g[1],g[2],_[0],_[1],_[2],_[0]+$[0],_[1]+$[1],_[2]+$[2]))&&(e.k[c].to=null,e.k[c].ti=null),g[0]===_[0]&&g[1]===_[1]&&b[0]===0&&b[1]===0&&$[0]===0&&$[1]===0&&(g.length===2||g[2]===_[2]&&b[2]===0&&$[2]===0)&&(e.k[c].to=null,e.k[c].ti=null));this.effectsSequence=[getValueAtCurrentTime.bind(this)],this.data=e,this.keyframes=e.k,this.keyframesMetadata=[],this.offsetTime=s.data.st,this.k=!0,this.kf=!0,this._isFirstFrame=!0,this.mult=a||1,this.elem=s,this.container=o,this.comp=s.comp,this.getValue=processEffectsSequence,this.setVValue=setVValue,this.interpolateValue=interpolateValue,this.frameId=-1;var tt=e.k[0].s.length;for(this.v=createTypedArray("float32",tt),this.pv=createTypedArray("float32",tt),c=0;c<tt;c+=1)this.v[c]=initFrame,this.pv[c]=initFrame;this._caching={lastFrame:initFrame,lastIndex:0,value:createTypedArray("float32",tt)},this.addEffect=addEffect}var PropertyFactory=function(){function s(a,o,c,d,g){o.sid&&(o=a.globalData.slotManager.getProp(o));var _;if(!o.k.length)_=new ValueProperty(a,o,d,g);else if(typeof o.k[0]=="number")_=new MultiDimensionalProperty(a,o,d,g);else switch(c){case 0:_=new KeyframedValueProperty(a,o,d,g);break;case 1:_=new KeyframedMultidimensionalProperty(a,o,d,g);break}return _.effectsSequence.length&&g.addDynamicProperty(_),_}var e={getProp:s};return e}();function DynamicPropertyContainer(){}DynamicPropertyContainer.prototype={addDynamicProperty:function(e){this.dynamicProperties.indexOf(e)===-1&&(this.dynamicProperties.push(e),this.container.addDynamicProperty(this),this._isAnimated=!0)},iterateDynamicProperties:function(){this._mdf=!1;var e,a=this.dynamicProperties.length;for(e=0;e<a;e+=1)this.dynamicProperties[e].getValue(),this.dynamicProperties[e]._mdf&&(this._mdf=!0)},initDynamicPropertyContainer:function(e){this.container=e,this.dynamicProperties=[],this._mdf=!1,this._isAnimated=!1}};var pointPool=function(){function s(){return createTypedArray("float32",2)}return poolFactory(8,s)}();function ShapePath(){this.c=!1,this._length=0,this._maxLength=8,this.v=createSizedArray(this._maxLength),this.o=createSizedArray(this._maxLength),this.i=createSizedArray(this._maxLength)}ShapePath.prototype.setPathData=function(s,e){this.c=s,this.setLength(e);for(var a=0;a<e;)this.v[a]=pointPool.newElement(),this.o[a]=pointPool.newElement(),this.i[a]=pointPool.newElement(),a+=1},ShapePath.prototype.setLength=function(s){for(;this._maxLength<s;)this.doubleArrayLength();this._length=s},ShapePath.prototype.doubleArrayLength=function(){this.v=this.v.concat(createSizedArray(this._maxLength)),this.i=this.i.concat(createSizedArray(this._maxLength)),this.o=this.o.concat(createSizedArray(this._maxLength)),this._maxLength*=2},ShapePath.prototype.setXYAt=function(s,e,a,o,c){var d;switch(this._length=Math.max(this._length,o+1),this._length>=this._maxLength&&this.doubleArrayLength(),a){case"v":d=this.v;break;case"i":d=this.i;break;case"o":d=this.o;break;default:d=[];break}(!d[o]||d[o]&&!c)&&(d[o]=pointPool.newElement()),d[o][0]=s,d[o][1]=e},ShapePath.prototype.setTripleAt=function(s,e,a,o,c,d,g,_){this.setXYAt(s,e,"v",g,_),this.setXYAt(a,o,"o",g,_),this.setXYAt(c,d,"i",g,_)},ShapePath.prototype.reverse=function(){var s=new ShapePath;s.setPathData(this.c,this._length);var e=this.v,a=this.o,o=this.i,c=0;this.c&&(s.setTripleAt(e[0][0],e[0][1],o[0][0],o[0][1],a[0][0],a[0][1],0,!1),c=1);var d=this._length-1,g=this._length,_;for(_=c;_<g;_+=1)s.setTripleAt(e[d][0],e[d][1],o[d][0],o[d][1],a[d][0],a[d][1],_,!1),d-=1;return s},ShapePath.prototype.length=function(){return this._length};var shapePool=function(){function s(){return new ShapePath}function e(c){var d=c._length,g;for(g=0;g<d;g+=1)pointPool.release(c.v[g]),pointPool.release(c.i[g]),pointPool.release(c.o[g]),c.v[g]=null,c.i[g]=null,c.o[g]=null;c._length=0,c.c=!1}function a(c){var d=o.newElement(),g,_=c._length===void 0?c.v.length:c._length;for(d.setLength(_),d.c=c.c,g=0;g<_;g+=1)d.setTripleAt(c.v[g][0],c.v[g][1],c.o[g][0],c.o[g][1],c.i[g][0],c.i[g][1],g);return d}var o=poolFactory(4,s,e);return o.clone=a,o}();function ShapeCollection(){this._length=0,this._maxLength=4,this.shapes=createSizedArray(this._maxLength)}ShapeCollection.prototype.addShape=function(s){this._length===this._maxLength&&(this.shapes=this.shapes.concat(createSizedArray(this._maxLength)),this._maxLength*=2),this.shapes[this._length]=s,this._length+=1},ShapeCollection.prototype.releaseShapes=function(){var s;for(s=0;s<this._length;s+=1)shapePool.release(this.shapes[s]);this._length=0};var shapeCollectionPool=function(){var s={newShapeCollection:c,release:d},e=0,a=4,o=createSizedArray(a);function c(){var g;return e?(e-=1,g=o[e]):g=new ShapeCollection,g}function d(g){var _,b=g._length;for(_=0;_<b;_+=1)shapePool.release(g.shapes[_]);g._length=0,e===a&&(o=pooling.double(o),a*=2),o[e]=g,e+=1}return s}(),ShapePropertyFactory=function(){var s=-999999;function e(_e,it,nt){var ct=nt.lastIndex,ht,ft,pt,yt,vt,gt,Ct,Pt,Tt,Rt=this.keyframes;if(_e<Rt[0].t-this.offsetTime)ht=Rt[0].s[0],pt=!0,ct=0;else if(_e>=Rt[Rt.length-1].t-this.offsetTime)ht=Rt[Rt.length-1].s?Rt[Rt.length-1].s[0]:Rt[Rt.length-2].e[0],pt=!0;else{for(var wt=ct,_t=Rt.length-1,St=!0,ut,dt,Mt;St&&(ut=Rt[wt],dt=Rt[wt+1],!(dt.t-this.offsetTime>_e));)wt<_t-1?wt+=1:St=!1;if(Mt=this.keyframesMetadata[wt]||{},pt=ut.h===1,ct=wt,!pt){if(_e>=dt.t-this.offsetTime)Pt=1;else if(_e<ut.t-this.offsetTime)Pt=0;else{var At;Mt.__fnct?At=Mt.__fnct:(At=BezierFactory.getBezierEasing(ut.o.x,ut.o.y,ut.i.x,ut.i.y).get,Mt.__fnct=At),Pt=At((_e-(ut.t-this.offsetTime))/(dt.t-this.offsetTime-(ut.t-this.offsetTime)))}ft=dt.s?dt.s[0]:ut.e[0]}ht=ut.s[0]}for(gt=it._length,Ct=ht.i[0].length,nt.lastIndex=ct,yt=0;yt<gt;yt+=1)for(vt=0;vt<Ct;vt+=1)Tt=pt?ht.i[yt][vt]:ht.i[yt][vt]+(ft.i[yt][vt]-ht.i[yt][vt])*Pt,it.i[yt][vt]=Tt,Tt=pt?ht.o[yt][vt]:ht.o[yt][vt]+(ft.o[yt][vt]-ht.o[yt][vt])*Pt,it.o[yt][vt]=Tt,Tt=pt?ht.v[yt][vt]:ht.v[yt][vt]+(ft.v[yt][vt]-ht.v[yt][vt])*Pt,it.v[yt][vt]=Tt}function a(){var _e=this.comp.renderedFrame-this.offsetTime,it=this.keyframes[0].t-this.offsetTime,nt=this.keyframes[this.keyframes.length-1].t-this.offsetTime,ct=this._caching.lastFrame;return ct!==s&&(ct<it&&_e<it||ct>nt&&_e>nt)||(this._caching.lastIndex=ct<_e?this._caching.lastIndex:0,this.interpolateShape(_e,this.pv,this._caching)),this._caching.lastFrame=_e,this.pv}function o(){this.paths=this.localShapeCollection}function c(_e,it){if(_e._length!==it._length||_e.c!==it.c)return!1;var nt,ct=_e._length;for(nt=0;nt<ct;nt+=1)if(_e.v[nt][0]!==it.v[nt][0]||_e.v[nt][1]!==it.v[nt][1]||_e.o[nt][0]!==it.o[nt][0]||_e.o[nt][1]!==it.o[nt][1]||_e.i[nt][0]!==it.i[nt][0]||_e.i[nt][1]!==it.i[nt][1])return!1;return!0}function d(_e){c(this.v,_e)||(this.v=shapePool.clone(_e),this.localShapeCollection.releaseShapes(),this.localShapeCollection.addShape(this.v),this._mdf=!0,this.paths=this.localShapeCollection)}function g(){if(this.elem.globalData.frameId!==this.frameId){if(!this.effectsSequence.length){this._mdf=!1;return}if(this.lock){this.setVValue(this.pv);return}this.lock=!0,this._mdf=!1;var _e;this.kf?_e=this.pv:this.data.ks?_e=this.data.ks.k:_e=this.data.pt.k;var it,nt=this.effectsSequence.length;for(it=0;it<nt;it+=1)_e=this.effectsSequence[it](_e);this.setVValue(_e),this.lock=!1,this.frameId=this.elem.globalData.frameId}}function _(_e,it,nt){this.propType="shape",this.comp=_e.comp,this.container=_e,this.elem=_e,this.data=it,this.k=!1,this.kf=!1,this._mdf=!1;var ct=nt===3?it.pt.k:it.ks.k;this.v=shapePool.clone(ct),this.pv=shapePool.clone(this.v),this.localShapeCollection=shapeCollectionPool.newShapeCollection(),this.paths=this.localShapeCollection,this.paths.addShape(this.v),this.reset=o,this.effectsSequence=[]}function b(_e){this.effectsSequence.push(_e),this.container.addDynamicProperty(this)}_.prototype.interpolateShape=e,_.prototype.getValue=g,_.prototype.setVValue=d,_.prototype.addEffect=b;function $(_e,it,nt){this.propType="shape",this.comp=_e.comp,this.elem=_e,this.container=_e,this.offsetTime=_e.data.st,this.keyframes=nt===3?it.pt.k:it.ks.k,this.keyframesMetadata=[],this.k=!0,this.kf=!0;var ct=this.keyframes[0].s[0].i.length;this.v=shapePool.newElement(),this.v.setPathData(this.keyframes[0].s[0].c,ct),this.pv=shapePool.clone(this.v),this.localShapeCollection=shapeCollectionPool.newShapeCollection(),this.paths=this.localShapeCollection,this.paths.addShape(this.v),this.lastFrame=s,this.reset=o,this._caching={lastFrame:s,lastIndex:0},this.effectsSequence=[a.bind(this)]}$.prototype.getValue=g,$.prototype.interpolateShape=e,$.prototype.setVValue=d,$.prototype.addEffect=b;var tt=function(){var _e=roundCorner;function it(nt,ct){this.v=shapePool.newElement(),this.v.setPathData(!0,4),this.localShapeCollection=shapeCollectionPool.newShapeCollection(),this.paths=this.localShapeCollection,this.localShapeCollection.addShape(this.v),this.d=ct.d,this.elem=nt,this.comp=nt.comp,this.frameId=-1,this.initDynamicPropertyContainer(nt),this.p=PropertyFactory.getProp(nt,ct.p,1,0,this),this.s=PropertyFactory.getProp(nt,ct.s,1,0,this),this.dynamicProperties.length?this.k=!0:(this.k=!1,this.convertEllToPath())}return it.prototype={reset:o,getValue:function(){this.elem.globalData.frameId!==this.frameId&&(this.frameId=this.elem.globalData.frameId,this.iterateDynamicProperties(),this._mdf&&this.convertEllToPath())},convertEllToPath:function(){var ct=this.p.v[0],ht=this.p.v[1],ft=this.s.v[0]/2,pt=this.s.v[1]/2,yt=this.d!==3,vt=this.v;vt.v[0][0]=ct,vt.v[0][1]=ht-pt,vt.v[1][0]=yt?ct+ft:ct-ft,vt.v[1][1]=ht,vt.v[2][0]=ct,vt.v[2][1]=ht+pt,vt.v[3][0]=yt?ct-ft:ct+ft,vt.v[3][1]=ht,vt.i[0][0]=yt?ct-ft*_e:ct+ft*_e,vt.i[0][1]=ht-pt,vt.i[1][0]=yt?ct+ft:ct-ft,vt.i[1][1]=ht-pt*_e,vt.i[2][0]=yt?ct+ft*_e:ct-ft*_e,vt.i[2][1]=ht+pt,vt.i[3][0]=yt?ct-ft:ct+ft,vt.i[3][1]=ht+pt*_e,vt.o[0][0]=yt?ct+ft*_e:ct-ft*_e,vt.o[0][1]=ht-pt,vt.o[1][0]=yt?ct+ft:ct-ft,vt.o[1][1]=ht+pt*_e,vt.o[2][0]=yt?ct-ft*_e:ct+ft*_e,vt.o[2][1]=ht+pt,vt.o[3][0]=yt?ct-ft:ct+ft,vt.o[3][1]=ht-pt*_e}},extendPrototype([DynamicPropertyContainer],it),it}(),rt=function(){function _e(it,nt){this.v=shapePool.newElement(),this.v.setPathData(!0,0),this.elem=it,this.comp=it.comp,this.data=nt,this.frameId=-1,this.d=nt.d,this.initDynamicPropertyContainer(it),nt.sy===1?(this.ir=PropertyFactory.getProp(it,nt.ir,0,0,this),this.is=PropertyFactory.getProp(it,nt.is,0,.01,this),this.convertToPath=this.convertStarToPath):this.convertToPath=this.convertPolygonToPath,this.pt=PropertyFactory.getProp(it,nt.pt,0,0,this),this.p=PropertyFactory.getProp(it,nt.p,1,0,this),this.r=PropertyFactory.getProp(it,nt.r,0,degToRads,this),this.or=PropertyFactory.getProp(it,nt.or,0,0,this),this.os=PropertyFactory.getProp(it,nt.os,0,.01,this),this.localShapeCollection=shapeCollectionPool.newShapeCollection(),this.localShapeCollection.addShape(this.v),this.paths=this.localShapeCollection,this.dynamicProperties.length?this.k=!0:(this.k=!1,this.convertToPath())}return _e.prototype={reset:o,getValue:function(){this.elem.globalData.frameId!==this.frameId&&(this.frameId=this.elem.globalData.frameId,this.iterateDynamicProperties(),this._mdf&&this.convertToPath())},convertStarToPath:function(){var nt=Math.floor(this.pt.v)*2,ct=Math.PI*2/nt,ht=!0,ft=this.or.v,pt=this.ir.v,yt=this.os.v,vt=this.is.v,gt=2*Math.PI*ft/(nt*2),Ct=2*Math.PI*pt/(nt*2),Pt,Tt,Rt,wt,_t=-Math.PI/2;_t+=this.r.v;var St=this.data.d===3?-1:1;for(this.v._length=0,Pt=0;Pt<nt;Pt+=1){Tt=ht?ft:pt,Rt=ht?yt:vt,wt=ht?gt:Ct;var ut=Tt*Math.cos(_t),dt=Tt*Math.sin(_t),Mt=ut===0&&dt===0?0:dt/Math.sqrt(ut*ut+dt*dt),At=ut===0&&dt===0?0:-ut/Math.sqrt(ut*ut+dt*dt);ut+=+this.p.v[0],dt+=+this.p.v[1],this.v.setTripleAt(ut,dt,ut-Mt*wt*Rt*St,dt-At*wt*Rt*St,ut+Mt*wt*Rt*St,dt+At*wt*Rt*St,Pt,!0),ht=!ht,_t+=ct*St}},convertPolygonToPath:function(){var nt=Math.floor(this.pt.v),ct=Math.PI*2/nt,ht=this.or.v,ft=this.os.v,pt=2*Math.PI*ht/(nt*4),yt,vt=-Math.PI*.5,gt=this.data.d===3?-1:1;for(vt+=this.r.v,this.v._length=0,yt=0;yt<nt;yt+=1){var Ct=ht*Math.cos(vt),Pt=ht*Math.sin(vt),Tt=Ct===0&&Pt===0?0:Pt/Math.sqrt(Ct*Ct+Pt*Pt),Rt=Ct===0&&Pt===0?0:-Ct/Math.sqrt(Ct*Ct+Pt*Pt);Ct+=+this.p.v[0],Pt+=+this.p.v[1],this.v.setTripleAt(Ct,Pt,Ct-Tt*pt*ft*gt,Pt-Rt*pt*ft*gt,Ct+Tt*pt*ft*gt,Pt+Rt*pt*ft*gt,yt,!0),vt+=ct*gt}this.paths.length=0,this.paths[0]=this.v}},extendPrototype([DynamicPropertyContainer],_e),_e}(),et=function(){function _e(it,nt){this.v=shapePool.newElement(),this.v.c=!0,this.localShapeCollection=shapeCollectionPool.newShapeCollection(),this.localShapeCollection.addShape(this.v),this.paths=this.localShapeCollection,this.elem=it,this.comp=it.comp,this.frameId=-1,this.d=nt.d,this.initDynamicPropertyContainer(it),this.p=PropertyFactory.getProp(it,nt.p,1,0,this),this.s=PropertyFactory.getProp(it,nt.s,1,0,this),this.r=PropertyFactory.getProp(it,nt.r,0,0,this),this.dynamicProperties.length?this.k=!0:(this.k=!1,this.convertRectToPath())}return _e.prototype={convertRectToPath:function(){var nt=this.p.v[0],ct=this.p.v[1],ht=this.s.v[0]/2,ft=this.s.v[1]/2,pt=bmMin(ht,ft,this.r.v),yt=pt*(1-roundCorner);this.v._length=0,this.d===2||this.d===1?(this.v.setTripleAt(nt+ht,ct-ft+pt,nt+ht,ct-ft+pt,nt+ht,ct-ft+yt,0,!0),this.v.setTripleAt(nt+ht,ct+ft-pt,nt+ht,ct+ft-yt,nt+ht,ct+ft-pt,1,!0),pt!==0?(this.v.setTripleAt(nt+ht-pt,ct+ft,nt+ht-pt,ct+ft,nt+ht-yt,ct+ft,2,!0),this.v.setTripleAt(nt-ht+pt,ct+ft,nt-ht+yt,ct+ft,nt-ht+pt,ct+ft,3,!0),this.v.setTripleAt(nt-ht,ct+ft-pt,nt-ht,ct+ft-pt,nt-ht,ct+ft-yt,4,!0),this.v.setTripleAt(nt-ht,ct-ft+pt,nt-ht,ct-ft+yt,nt-ht,ct-ft+pt,5,!0),this.v.setTripleAt(nt-ht+pt,ct-ft,nt-ht+pt,ct-ft,nt-ht+yt,ct-ft,6,!0),this.v.setTripleAt(nt+ht-pt,ct-ft,nt+ht-yt,ct-ft,nt+ht-pt,ct-ft,7,!0)):(this.v.setTripleAt(nt-ht,ct+ft,nt-ht+yt,ct+ft,nt-ht,ct+ft,2),this.v.setTripleAt(nt-ht,ct-ft,nt-ht,ct-ft+yt,nt-ht,ct-ft,3))):(this.v.setTripleAt(nt+ht,ct-ft+pt,nt+ht,ct-ft+yt,nt+ht,ct-ft+pt,0,!0),pt!==0?(this.v.setTripleAt(nt+ht-pt,ct-ft,nt+ht-pt,ct-ft,nt+ht-yt,ct-ft,1,!0),this.v.setTripleAt(nt-ht+pt,ct-ft,nt-ht+yt,ct-ft,nt-ht+pt,ct-ft,2,!0),this.v.setTripleAt(nt-ht,ct-ft+pt,nt-ht,ct-ft+pt,nt-ht,ct-ft+yt,3,!0),this.v.setTripleAt(nt-ht,ct+ft-pt,nt-ht,ct+ft-yt,nt-ht,ct+ft-pt,4,!0),this.v.setTripleAt(nt-ht+pt,ct+ft,nt-ht+pt,ct+ft,nt-ht+yt,ct+ft,5,!0),this.v.setTripleAt(nt+ht-pt,ct+ft,nt+ht-yt,ct+ft,nt+ht-pt,ct+ft,6,!0),this.v.setTripleAt(nt+ht,ct+ft-pt,nt+ht,ct+ft-pt,nt+ht,ct+ft-yt,7,!0)):(this.v.setTripleAt(nt-ht,ct-ft,nt-ht+yt,ct-ft,nt-ht,ct-ft,1,!0),this.v.setTripleAt(nt-ht,ct+ft,nt-ht,ct+ft-yt,nt-ht,ct+ft,2,!0),this.v.setTripleAt(nt+ht,ct+ft,nt+ht-yt,ct+ft,nt+ht,ct+ft,3,!0)))},getValue:function(){this.elem.globalData.frameId!==this.frameId&&(this.frameId=this.elem.globalData.frameId,this.iterateDynamicProperties(),this._mdf&&this.convertRectToPath())},reset:o},extendPrototype([DynamicPropertyContainer],_e),_e}();function st(_e,it,nt){var ct;if(nt===3||nt===4){var ht=nt===3?it.pt:it.ks,ft=ht.k;ft.length?ct=new $(_e,it,nt):ct=new _(_e,it,nt)}else nt===5?ct=new et(_e,it):nt===6?ct=new tt(_e,it):nt===7&&(ct=new rt(_e,it));return ct.k&&_e.addDynamicProperty(ct),ct}function ot(){return _}function at(){return $}var lt={};return lt.getShapeProp=st,lt.getConstructorFunction=ot,lt.getKeyframedConstructorFunction=at,lt}();/*!
 Transformation Matrix v2.0
 (c) Epistemex 2014-2015
 www.epistemex.com
 By Ken Fyrstenberg
 Contributions by leeoniya.
 License: MIT, header required.
`,jsxRuntimeExports.jsx("span",{className:"text-red-500",children:"const"})," ",jsxRuntimeExports.jsx("span",{className:"text-purple-300",children:"programmingLanguages"})," = ",`{
`,jsxRuntimeExports.jsx("span",{className:"text-yellow-500",children:"    languages"}),": ['",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"C++"}),"', '",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"Python"}),"', '",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"Java"}),"'],",`
`,"};",`
`]})})}),jsxRuntimeExports.jsx("div",{className:"mt-8 mr-32 max-w-4xl bg-gray-900 rounded-lg p-6 shadow-lg",children:jsxRuntimeExports.jsx("pre",{className:"text-base sm:text-lg text-left text-white",children:jsxRuntimeExports.jsxs("code",{children:[jsxRuntimeExports.jsx("span",{className:"text-blue-400",children:"// Frameworks and libraries I've worked with"}),`
`,jsxRuntimeExports.jsx("span",{className:"text-red-500",children:"const"})," ",jsxRuntimeExports.jsx("span",{className:"text-purple-300",children:"frameworksAndLibraries"})," = ",`{
`,jsxRuntimeExports.jsx("span",{className:"text-yellow-500",children:"    frameworks"}),": ['",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"React"}),"', '",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"Node.js"}),"'],",`
`,jsxRuntimeExports.jsx("span",{className:"text-yellow-500",children:"    libraries"}),": ['",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"Pandas"}),"','",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"Matplotlib"}),"','",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"NumPy"}),"', '",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"OpenCV"}),"'],",`
`,"};",`
`]})})}),jsxRuntimeExports.jsx("div",{className:"mt-8 mr-32 max-w-4xl bg-gray-900 rounded-lg p-6 shadow-lg",children:jsxRuntimeExports.jsx("pre",{className:"text-base sm:text-lg text-left text-white",children:jsxRuntimeExports.jsxs("code",{children:[jsxRuntimeExports.jsx("span",{className:"text-blue-400",children:"// Additional skills I've developed"}),`
`,jsxRuntimeExports.jsx("span",{className:"text-red-500",children:"const"})," ",jsxRuntimeExports.jsx("span",{className:"text-purple-300",children:"additionals"})," = ['",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"Chess"}),"', '",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"Pixel Art"}),"', '",jsxRuntimeExports.jsx("span",{className:"text-green-500",children:"Data Science"}),"'];",`
`]})})})]})]})},image1="/website/assets/chess-DZNQt5eB.png",image2="/website/assets/grabby-CSihl_Sg.png",image3="/website/assets/forestfire-BlNqSlHA.png",image4="/website/assets/gameoflife-BVdy4VOj.jpg";function Modal({project:s,onClose:e}){const a=o=>{o.target.id==="modal-backdrop"&&e()};return jsxRuntimeExports.jsx("div",{id:"modal-backdrop",className:"fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center",onClick:a,children:jsxRuntimeExports.jsx("div",{className:"bg-dark p-6 bg-opacity-75 backdrop-blur rounded-lg shadow-lg max-w-lg max-h-screen overflow-auto",children:jsxRuntimeExports.jsxs("div",{className:"mt-4",children:[jsxRuntimeExports.jsx("h3",{className:"text-2xl font-bold mb-4 text-white",children:s.title}),jsxRuntimeExports.jsx("p",{className:"text-lg text-white",children:s.content}),jsxRuntimeExports.jsxs("div",{className:"mt-6",children:[jsxRuntimeExports.jsx("p",{className:"text-white",children:s.description}),jsxRuntimeExports.jsx("ul",{className:"list-disc list-inside mt-4 text-white",children:s.features.map((o,c)=>jsxRuntimeExports.jsx("li",{children:o},c))})]})]})})})}const GridTiles=()=>{const[s,e]=reactExports.useState(null),a=[{img:image1,title:"Chess Engine",content:"Software Project",description:"A decent chess engine built using C++.",features:["AI opponent from terminal","Move analysis","Plays at ~1200 ELO"]},{img:image2,title:"Grabby - OCR + Snipping Tool",content:"Software Project",description:"A versatile tool combining OCR and snipping capabilities.",features:["Text extraction from images","Snipping tool integration","Multi-language support"]},{img:image3,title:"Forest Fire Modelling",content:"Data Science Project",description:"A series of models designed to examine which factors predispose areas to forest fires most.",features:["Analyzed causes of spread rates","Determined the most predictive factor extractable from public data to be humidity","Discovered weather to be a surprisingly poor predictor of forest fires - likely due to data chunking"]},{img:image4,title:"3D Game of Life",content:"Scroll up :P",description:"A 3D implementation of the classic cellular automaton.",features:["Stores previous cycles on the y-axis","Real-time 3D rendering","Shows how the game evolves over time"]}],o=d=>{e(d)},c=()=>{e(null)};return jsxRuntimeExports.jsxs("div",{className:"bg-dark grid grid-cols-1 items-center justify-items-center h-screen",children:[jsxRuntimeExports.jsx("h2",{className:"text-8xl font-bold text-white mt-32 text-center col-span-full",children:"MY PROJECTS"}),jsxRuntimeExports.jsx("div",{className:"grid grid-cols-2 gap-8 w-2/4 px-4 mt-24",children:a.map((d,g)=>jsxRuntimeExports.jsx("div",{className:"transition-transform hover:scale-105 hover:-translate-y-2",onClick:()=>o(d),children:jsxRuntimeExports.jsx("div",{style:{backgroundImage:`url(${d.img})`},className:"bg-cover bg-center rounded-lg h-72 w-full flex items-center justify-center",children:jsxRuntimeExports.jsx("div",{className:"bg-black bg-opacity-40 backdrop-blur rounded-full px-2 py-1",children:jsxRuntimeExports.jsx("span",{className:"text-white text-3xl font-semibold",children:d.title})})})},g))}),s&&jsxRuntimeExports.jsx(Modal,{project:s,onClose:c})]})};function FaGithub(s){return GenIcon({tag:"svg",attr:{viewBox:"0 0 496 512"},child:[{tag:"path",attr:{d:"M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"},child:[]}]})(s)}function FaLinkedin(s){return GenIcon({tag:"svg",attr:{viewBox:"0 0 448 512"},child:[{tag:"path",attr:{d:"M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3zM135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.2 0 79.7 44.3 79.7 101.9V416z"},child:[]}]})(s)}const Contact=()=>{const s=[{icon:jsxRuntimeExports.jsx(FaGithub,{className:"text-4xl"}),label:"GitHub",link:"https://github.com/nicholasmayerrupert"},{icon:jsxRuntimeExports.jsx(FaLinkedin,{className:"text-4xl"}),label:"LinkedIn",link:"https://www.linkedin.com/in/nicholas-mayer-rupert/"}];return jsxRuntimeExports.jsx("div",{className:"pt-48 bg-dark py-12",children:jsxRuntimeExports.jsxs("div",{className:"container mx-auto",children:[jsxRuntimeExports.jsx("h2",{className:"text-4xl font-bold mb-8 text-center text-white",children:"Contact Me :D"}),jsxRuntimeExports.jsx("div",{className:"flex justify-center",children:jsxRuntimeExports.jsx("div",{className:"grid grid-cols-1 sm:grid-cols-2 gap-8",children:s.map((e,a)=>jsxRuntimeExports.jsxs("a",{href:e.link,target:"_blank",rel:"noopener noreferrer",className:"bg-gray-900 rounded-lg shadow-md p-6 flex flex-col items-center hover:bg-gray-800 transition duration-300",children:[jsxRuntimeExports.jsx("div",{className:"text-blue-600 mb-4",children:e.icon}),jsxRuntimeExports.jsx("h3",{className:"text-xl font-semibold text-white",children:e.label})]},a))})}),jsxRuntimeExports.jsx("div",{className:"mt-8 text-center",children:jsxRuntimeExports.jsx("p",{className:"text-white",children:"Email: njmrme@gmail.com"})})]})})},App=()=>jsxRuntimeExports.jsxs("div",{className:"relative h-screen w-full",children:[jsxRuntimeExports.jsx(NavBar,{}),jsxRuntimeExports.jsx("div",{id:"home",children:jsxRuntimeExports.jsx(Hero,{})}),jsxRuntimeExports.jsx("div",{id:"skills",children:jsxRuntimeExports.jsx(About,{})}),jsxRuntimeExports.jsx("div",{id:"projects",children:jsxRuntimeExports.jsx(GridTiles,{})}),jsxRuntimeExports.jsx("div",{id:"contact",children:jsxRuntimeExports.jsx(Contact,{})})]});client.createRoot(document.getElementById("root")).render(jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment,{children:jsxRuntimeExports.jsx(App,{})}));