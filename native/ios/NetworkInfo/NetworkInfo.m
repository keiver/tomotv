//
//  NetworkInfo.m
//  TomoTV
//
//  React Native export of the NetworkInfo Swift module.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// RCTEventEmitter: `onNetworkPath` reports the network path while JS listens.
@interface RCT_EXTERN_MODULE(NetworkInfo, RCTEventEmitter)

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

// Resolve the /System/Info/Public body over TLS with the certificate accepted, or null.
RCT_EXTERN_METHOD(probeSecureServerInfo:(nonnull NSString *)host
                  port:(nonnull NSNumber *)port
                  timeoutMs:(nonnull NSNumber *)timeoutMs
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
