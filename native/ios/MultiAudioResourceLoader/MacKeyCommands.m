//
//  MacKeyCommands.m
//  TomoTV
//
//  React Native bridge for the MacKeyCommands Swift module. Events only, so there
//  is nothing to declare here beyond the module itself.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// RCTEventEmitter, not NSObject: the module's whole job is delivering key presses
// to JS over `onMacKeyCommand`.
@interface RCT_EXTERN_MODULE (MacKeyCommands, RCTEventEmitter)

@end
