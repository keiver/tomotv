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

// Resolve [{ host, port }] for every host/port pair that accepts a TCP connection.
RCT_EXTERN_METHOD(scanOpenPorts:(nonnull NSArray *)hosts
                  ports:(nonnull NSArray *)ports
                  timeoutMs:(nonnull NSNumber *)timeoutMs
                  maxConcurrent:(nonnull NSNumber *)maxConcurrent
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
