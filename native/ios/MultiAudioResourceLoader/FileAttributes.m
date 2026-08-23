//
//  FileAttributes.m
//  TomoTV
//
//  React Native bridge for the FileAttributes Swift module.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FileAttributes, NSObject)

RCT_EXTERN_METHOD(setExcludedFromBackup
                  : (NSString *)path excluded
                  : (BOOL)excluded resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isExcludedFromBackup
                  : (NSString *)path resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
