//
//  LocalRemuxer.m
//  TomoTV
//
//  Objective-C bridge exposing the LocalRemuxer Swift module to React Native.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// RCTEventEmitter, not NSObject: the engine reports its own per-stream
// decisions over `onEnginePlan` (EnginePlan.swift explains why it has to).
@interface RCT_EXTERN_MODULE (LocalRemuxer, RCTEventEmitter)

RCT_EXTERN_METHOD(startRemux
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopRemux
                  : (nonnull NSString *)token resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startPlaylistShim
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopPlaylistShim
                  : (nonnull NSString *)token resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isAV1HardwareDecodeSupported
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
