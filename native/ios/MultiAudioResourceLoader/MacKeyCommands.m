//
//  MacKeyCommands.m
//  TomoTV
//
//  React Native bridge for the MacKeyCommands Swift module: the event stream, plus the
//  one setter a screen uses to claim the bare arrow keys while it is on screen.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// RCTEventEmitter, not NSObject: the module's whole job is delivering key presses
// to JS over `onMacKeyCommand`.
@interface RCT_EXTERN_MODULE (MacKeyCommands, RCTEventEmitter)

// "photo", "seek", or "" for nobody. Bare arrows are registered only while a screen owns
// them, so a grid keeps its own arrow scrolling everywhere else.
RCT_EXTERN_METHOD(setArrowContext : (NSString *)context)

@end
