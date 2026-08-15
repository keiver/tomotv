//
//  DeviceEnvironment.m
//  TomoTV
//
//  React Native bridge for the DeviceEnvironment Swift module. Constants only,
//  so there is nothing to declare here beyond the module itself.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DeviceEnvironment, NSObject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
