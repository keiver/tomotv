//
//  NetworkInfo.m
//  TomoTV
//
//  React Native bridge for the NetworkInfo Swift module.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(NetworkInfo, NSObject)

// Resolve { ip, netmask, interfaceName } for the active IPv4 interface, or null.
RCT_EXTERN_METHOD(getLocalNetworkInfo:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
