//
//  RemoteTouch.m
//  TomoTV
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (RemoteTouch, RCTEventEmitter)

RCT_EXTERN_METHOD(setArmed : (BOOL)armed)

@end
