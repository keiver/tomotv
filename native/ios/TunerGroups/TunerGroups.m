//
//  TunerGroups.m
//  TomoTV
//
//  Objective-C bridge exposing the TunerGroups Swift module to React Native.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (TunerGroups, NSObject)

RCT_EXTERN_METHOD(loadTunerGroups
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelLoad
                  : (nonnull NSString *)requestId resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
