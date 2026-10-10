//
//  DeviceEnvironment.m
//  TomoTV
//
//  React Native bridge for the DeviceEnvironment Swift module.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DeviceEnvironment, NSObject)

RCT_EXTERN_METHOD(setWindowSizeLock:(BOOL)enabled width:(double)width height:(double)height)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
