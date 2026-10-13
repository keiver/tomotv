//
//  LyricsListener.m
//  TomoTV
//
//  Objective-C bridge exposing the LyricsListener Swift module to React Native.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (LyricsListener, NSObject)

RCT_EXTERN_METHOD(capability
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(transcribe
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
