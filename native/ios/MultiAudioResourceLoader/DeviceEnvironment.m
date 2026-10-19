//
//  DeviceEnvironment.m
//  TomoTV
//
//  React Native export of the DeviceEnvironment Swift module.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DeviceEnvironment, NSObject)

RCT_EXTERN_METHOD(setWindowSizeLock:(BOOL)enabled width:(double)width height:(double)height)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(showCaptionsAlways)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
