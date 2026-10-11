# React Native's dependency tarballs flatten the Catalyst framework's symlinks.
# Repair the embedded copy before CocoaPods strips architectures and signs it.
module TomoCatalystFrameworks
  MARKER = '# TomoTV: restore Catalyst framework symlinks'.freeze
  HOOK = <<~'SH'.freeze
    # TomoTV: restore Catalyst framework symlinks
    if [[ "${EFFECTIVE_PLATFORM_NAME:-}" == "-maccatalyst" && "$(basename "$1")" == "ReactNativeDependencies.framework" ]]; then
      /usr/bin/python3 "${PODS_ROOT}/../../scripts/fix-catalyst-framework.py" "${destination}/ReactNativeDependencies.framework"
    fi

  SH

  def self.patch_embed_script(path)
    return unless File.file?(path)

    contents = File.read(path)
    return if contents.include?(MARKER)

    anchor = '  basename="$(basename -s .framework "$1")"'
    unless contents.scan(anchor).size == 1
      raise 'Catalyst: cannot locate the framework embedding hook in the CocoaPods script.'
    end
    File.write(path, contents.sub(anchor, HOOK.lines.map { |line| line.strip.empty? ? "\n" : "  #{line}" }.join + anchor))
  end
end
