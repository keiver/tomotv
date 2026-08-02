//
//  LocalRemuxer.m
//  TomoTV
//
//  Objective-C bridge exposing the LocalRemuxer Swift module to React Native.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (LocalRemuxer, NSObject)

RCT_EXTERN_METHOD(startRemux
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopRemux
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isAV1HardwareDecodeSupported
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(benchmarkVideoTranscode
                  : (NSString *)url frames
                  : (nonnull NSNumber *)frames resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
